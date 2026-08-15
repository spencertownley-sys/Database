/**
 * Change sets — the write path.
 *
 * Every mutation in the product goes through here. Not most mutations: every
 * one, including a single cell edit, which is precisely what makes `Ctrl+Z`
 * behave identically for one cell and for a 300-row bulk edit. A service that
 * writes to `items` without a change set is a bug, including "quick" internal
 * updates.
 *
 * Lifecycle:
 *
 *   preview  → nothing is written to `items`. The set holds a computed
 *              before/after per affected item, a summary, and 20 sample rows,
 *              which is what the preview modal renders.
 *   commit   → one transaction. Each entry's stored `before` is compared
 *              against the item's current state; **any** mismatch fails the
 *              whole set with `STALE_PREVIEW` rather than clobbering a
 *              concurrent edit.
 *   undo     → builds the inverse set by swapping before/after, commits it
 *              with `source='undo'` and `parent_change_set_id` set, and marks
 *              the original `undone`.
 *
 * Two design decisions carry the correctness of undo:
 *
 *  1. **Entries store complete snapshots, not diffs.** Undo is then a swap,
 *     not a separate inverse implementation per operation — there is no
 *     `unset_field` to get subtly wrong.
 *
 *  2. **Derived columns are recomputed, never restored.** `effective_values`,
 *     `completeness_pct`, `missing_required`, `search_text`, and the projection
 *     index are all recomputed from the restored inputs, so undo cannot
 *     resurrect a derived value that no longer agrees with its own inputs.
 *
 * Operations that implicitly affect descendants (`reparent`, `delete`) expand
 * to the whole subtree at preview time. The alternative — relying on cascade
 * at commit — produces a preview that under-reports what is about to happen
 * and an undo that cannot restore what it never recorded.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { withWorkspace } from '@/server/db';
import {
  changeEntries,
  changeSets,
  type ChangeOperation,
  type ChangeSet,
  type ChangeSource,
  type ChangeSummary,
  type ChangeTarget,
  type ItemDraft,
  type SampleEntry,
} from '@/server/db/schema/changeSets';
import { items } from '@/server/db/schema/items';
import type { ItemValues } from '@/server/db/schema/items';
import { fields as fieldsTable, type Field } from '@/server/db/schema/itemTypes';
import { AppError } from '@/server/lib/errors';
import { appendKeys, keyBetween } from '@/server/lib/fractionalIndex';
import { childPath, repointPath } from '@/server/lib/ltree';
import { claimIdempotencyKey, completeIdempotencyKey } from '@/server/lib/redis';
import { can, type Actor } from './permissions.service';
import {
  applySnapshots,
  loadItems,
  loadSubtreeIds,
  loadTreeNodePaths,
  recomputeDerived,
  snapshotOf,
  type ApplyContext,
  type ItemSnapshot,
  type LoadedItem,
} from './items.service';
import { coerceValue, type CoerceContext } from '@/server/validation/fieldTypes';
import type { InvalidValues } from '@/server/db/schema/items';

export const BULK_SYNC_THRESHOLD = Number(process.env.BULK_SYNC_THRESHOLD ?? 500);
/** Beyond this a preview is refused outright rather than queued. */
export const MAX_ITEMS_PER_CHANGE_SET = 50_000;
const PREVIEW_TTL_MINUTES = 30;
const SAMPLE_SIZE = 20;

export interface ChangeContext {
  workspaceId: string;
  actor: Actor;
  source?: ChangeSource;
  idempotencyKey?: string;
}

export type { ItemDraft };

export interface ChangeSetInput {
  operation: ChangeOperation;
  itemTypeId?: string;
  target: ChangeTarget;
  patch?: Record<string, unknown>;
}

export interface PreviewResult {
  changeSet: ChangeSet;
  /** True when commit must be handed to the `bulkCommit` job. */
  requiresAsyncCommit: boolean;
}

export interface CommitResult {
  changeSet: ChangeSet;
  appliedCount: number;
  skippedCount: number;
  variantsPropagated: number;
}

interface PlannedEntry {
  before: ItemSnapshot | null;
  after: ItemSnapshot | null;
  title: string;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// canonical comparison
// ---------------------------------------------------------------------------

/** Key-order-independent JSON, so two equal snapshots always compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return val;
  });
}

export function snapshotsEqual(a: ItemSnapshot | null, b: ItemSnapshot | null): boolean {
  if (a === null || b === null) return a === b;
  return canonical(a) === canonical(b);
}

// ---------------------------------------------------------------------------
// schema loading
// ---------------------------------------------------------------------------

async function loadFieldsByType(
  tx: Tx,
  workspaceId: string,
  typeIds: readonly string[],
): Promise<Map<string, Field[]>> {
  const out = new Map<string, Field[]>();
  if (typeIds.length === 0) return out;

  const rows = await tx
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.workspaceId, workspaceId),
        inArray(fieldsTable.itemTypeId, [...typeIds]),
        isNull(fieldsTable.deletedAt),
      ),
    )
    .orderBy(fieldsTable.position);

  for (const row of rows) {
    const list = out.get(row.itemTypeId);
    if (list) list.push(row);
    else out.set(row.itemTypeId, [row]);
  }
  for (const id of typeIds) if (!out.has(id)) out.set(id, []);
  return out;
}

// ---------------------------------------------------------------------------
// target resolution
// ---------------------------------------------------------------------------

async function resolveTargetIds(
  tx: Tx,
  workspaceId: string,
  target: ChangeTarget,
  operation: ChangeOperation,
): Promise<string[]> {
  switch (target.kind) {
    case 'new':
      return [];

    case 'ids': {
      const ids = target.itemIds ?? [];
      return expandForOperation(tx, workspaceId, ids, operation, target);
    }

    case 'subtree': {
      if (!target.rootItemId) {
        throw new AppError('VALIDATION_ERROR', 'A subtree target needs a root item.');
      }
      const ids = await loadSubtreeIds(tx, workspaceId, target.rootItemId);
      return target.includeDescendants === false ? [target.rootItemId] : ids;
    }

    case 'filter': {
      // Resolved through the search provider so a filter-targeted bulk edit and
      // the grid the user selected from agree on the same set.
      const { resolveFilterToIds } = await import('@/server/search/PostgresSearchProvider');
      return resolveFilterToIds(tx, workspaceId, target.filter, MAX_ITEMS_PER_CHANGE_SET);
    }

    default:
      throw new AppError('VALIDATION_ERROR', 'Unrecognised change target.');
  }
}

/**
 * `reparent` and `delete` affect descendants whether or not the user selected
 * them. Expanding here means the preview reports the true blast radius and the
 * undo has an entry for every row it needs to put back.
 */
async function expandForOperation(
  tx: Tx,
  workspaceId: string,
  ids: readonly string[],
  operation: ChangeOperation,
  target: ChangeTarget,
): Promise<string[]> {
  if (operation !== 'delete' && operation !== 'reparent') return [...ids];
  if (target.includeDescendants === false) return [...ids];

  const expanded = new Set<string>(ids);
  for (const id of ids) {
    for (const descendantId of await loadSubtreeIds(tx, workspaceId, id)) {
      expanded.add(descendantId);
    }
  }
  return [...expanded];
}

// ---------------------------------------------------------------------------
// value coercion
// ---------------------------------------------------------------------------

async function buildCoerceContext(
  tx: Tx,
  workspaceId: string,
): Promise<CoerceContext> {
  const memberRows = await tx.execute(sql`
    select u.id, lower(u.email) as email
    from users u
    join workspace_members m on m.user_id = u.id
    where m.workspace_id = ${workspaceId} and m.status = 'active'
  `);
  const usersByEmail = new Map<string, string>();
  const knownUserIds = new Set<string>();
  for (const row of [...memberRows] as Array<{ id: string; email: string }>) {
    usersByEmail.set(row.email, row.id);
    knownUserIds.add(row.id.toLowerCase());
  }
  return { usersByEmail, knownUserIds, now: new Date() };
}

interface CoercionOutcome {
  values: ItemValues;
  invalidValues: InvalidValues;
  changedKeys: string[];
  invalidKeys: string[];
}

/**
 * Applies a patch of raw values to an item's own `values`.
 *
 * A value that fails coercion is recorded in `invalid_values` and the field is
 * removed from `values` — **the rest of the item still commits**. Rejecting a
 * whole row because one cell says "TBD" loses real user work and is reported as
 * data loss, so it is a PRD requirement, not a nicety.
 */
function applyValuePatch(
  current: ItemValues,
  currentInvalid: InvalidValues,
  patch: Record<string, unknown>,
  fields: readonly Field[],
  ctx: CoerceContext,
): CoercionOutcome {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const values: ItemValues = { ...current };
  const invalidValues: InvalidValues = { ...currentInvalid };
  const changedKeys: string[] = [];
  const invalidKeys: string[] = [];
  const at = new Date().toISOString();

  for (const [key, raw] of Object.entries(patch)) {
    const field = byKey.get(key);
    if (!field) {
      // A key with no live field is dropped rather than stored: writing it
      // would create a value nothing can read, render, or ever clean up.
      continue;
    }

    const result = coerceValue(field.type, raw, field.config, ctx);
    if (!result.ok) {
      invalidValues[key] = { raw: result.raw, message: result.message, at };
      if (values[key] !== undefined) delete values[key];
      invalidKeys.push(key);
      changedKeys.push(key);
      continue;
    }

    delete invalidValues[key];
    if (result.value === null) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        delete values[key];
        changedKeys.push(key);
      }
    } else if (canonical(values[key]) !== canonical(result.value)) {
      values[key] = result.value;
      changedKeys.push(key);
    }
  }

  return { values, invalidValues, changedKeys, invalidKeys };
}

// ---------------------------------------------------------------------------
// planning
// ---------------------------------------------------------------------------

interface PlanContext {
  tx: Tx;
  workspaceId: string;
  actor: Actor;
  fieldsByType: Map<string, Field[]>;
  coerceCtx: CoerceContext;
  treeNodePaths: Map<string, string[]>;
}

async function planEntries(
  plan: PlanContext,
  input: ChangeSetInput,
  loaded: readonly LoadedItem[],
): Promise<PlannedEntry[]> {
  const patch = input.patch ?? {};
  const entries: PlannedEntry[] = [];

  if (input.operation === 'create') {
    return planCreates(plan, input);
  }

  for (const item of loaded) {
    const before = snapshotOf(item);
    const fields = plan.fieldsByType.get(item.itemTypeId) ?? [];

    const decision = can(plan.actor, permissionActionFor(input.operation), {
      kind: 'item',
      treeNodePaths: plan.treeNodePaths.get(item.id) ?? [],
      fieldKeys: input.operation === 'set_field' ? Object.keys(patch.values ?? {}) : [],
    });

    if (decision !== true) {
      entries.push({
        before,
        after: before,
        title: item.title,
        skipped: true,
        skipReason: decision.message,
      });
      continue;
    }

    // Tech Spec §2.5 / API Design §4: a `shared` field is owned by the model
    // and read-only on every variant. A single-item write is refused with
    // FIELD_READ_ONLY; in a bulk edit the variant is skipped with a reason, so
    // the rest of the selection still applies and the preview says why.
    const readOnlyKeys = sharedKeysWrittenOnVariant(item, input, patch, fields);
    if (readOnlyKeys.length > 0) {
      if (loaded.length === 1) {
        throw new AppError(
          'FIELD_READ_ONLY',
          `${readOnlyKeys.map((k) => `"${k}"`).join(', ')} ${readOnlyKeys.length === 1 ? 'is' : 'are'} shared from the model and read-only on a variant. Edit the model to change it everywhere.`,
          { fieldKeys: readOnlyKeys, variantParentId: item.variantParentId },
        );
      }
      entries.push({
        before,
        after: before,
        title: item.title,
        skipped: true,
        skipReason: 'Shared fields are read-only on a variant — edit the model instead.',
      });
      continue;
    }

    const after = planOne(plan, input, item, before, fields, patch);
    entries.push({
      before,
      after,
      title: item.title,
      skipped: false,
    });
  }

  return entries;
}

function planOne(
  plan: PlanContext,
  input: ChangeSetInput,
  item: LoadedItem,
  before: ItemSnapshot,
  fields: readonly Field[],
  patch: Record<string, unknown>,
): ItemSnapshot | null {
  switch (input.operation) {
    case 'set_field': {
      const values = (patch.values ?? {}) as Record<string, unknown>;
      const titlePatch = patch.title;
      const outcome = applyValuePatch(
        before.values,
        before.invalidValues,
        values,
        fields,
        plan.coerceCtx,
      );
      return {
        ...before,
        title: typeof titlePatch === 'string' ? titlePatch : before.title,
        values: outcome.values,
        invalidValues: outcome.invalidValues,
      };
    }

    case 'clear_field': {
      const keys = (patch.fieldKeys ?? []) as string[];
      const values = { ...before.values };
      const invalidValues = { ...before.invalidValues };
      for (const key of keys) {
        delete values[key];
        delete invalidValues[key];
      }
      return { ...before, values, invalidValues };
    }

    case 'change_type': {
      const nextTypeId = patch.itemTypeId as string;
      const nextFields = plan.fieldsByType.get(nextTypeId) ?? [];
      const nextKeys = new Set(nextFields.map((f) => f.key));
      // Values whose key survives the type change are re-coerced against the
      // new field definition; values whose key does not exist in the target
      // type are dropped. The preview reports both counts before anything is
      // written, which is the only honest way to do this.
      const carried: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(before.values)) {
        if (nextKeys.has(key)) carried[key] = value;
      }
      const outcome = applyValuePatch({}, {}, carried, nextFields, plan.coerceCtx);
      return {
        ...before,
        itemTypeId: nextTypeId,
        values: outcome.values,
        invalidValues: outcome.invalidValues,
      };
    }

    case 'reparent': {
      const movingRootId = (patch.itemId as string | undefined) ?? before.id;
      const newParentId = (patch.parentId ?? null) as string | null;
      const oldRootPath = (patch.__oldRootPath as string | undefined) ?? before.path;
      const newRootPath = (patch.__newRootPath as string | undefined) ?? before.path;

      if (before.id === movingRootId) {
        return {
          ...before,
          parentId: newParentId,
          path: newRootPath,
          position: (patch.position as string | undefined) ?? before.position,
        };
      }
      // A descendant keeps its parent and only has its path prefix repointed.
      return { ...before, path: repointPath(before.path, oldRootPath, newRootPath) };
    }

    case 'tree_assign': {
      const nodeIds = (patch.treeNodeIds ?? []) as string[];
      return { ...before, treeNodeIds: [...new Set([...before.treeNodeIds, ...nodeIds])].sort() };
    }

    case 'tree_unassign': {
      const nodeIds = new Set((patch.treeNodeIds ?? []) as string[]);
      return { ...before, treeNodeIds: before.treeNodeIds.filter((id) => !nodeIds.has(id)).sort() };
    }

    case 'assign_user': {
      const assigneeId = (patch.assigneeId ?? null) as string | null;
      return { ...before, assigneeId };
    }

    case 'delete':
      return null;

    case 'variant_propagate':
      // Variant propagation writes nothing to the variant's own `values`; it
      // only forces a recompute of `effective_values`. The snapshot is
      // therefore unchanged and the work happens in recomputeDerived().
      return before;

    default:
      throw new AppError('VALIDATION_ERROR', `Unsupported operation "${input.operation}".`);
  }
}

async function planCreates(plan: PlanContext, input: ChangeSetInput): Promise<PlannedEntry[]> {
  const drafts = (input.target.drafts ?? []) as ItemDraft[];
  if (drafts.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Nothing to create.');
  }

  const defaultTypeId = input.itemTypeId;
  const parentIds = [
    ...new Set(drafts.map((d) => d.parentId).filter((id): id is string => Boolean(id))),
  ];
  const parents = await loadItems(plan.tx, plan.workspaceId, parentIds);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  // One contiguous block of order keys per parent, so a 200-row paste does not
  // interleave with existing siblings.
  const lastKeyByParent = new Map<string | null, string | null>();
  for (const parentId of [...parentIds, null]) {
    const [row] = await plan.tx
      .select({ position: items.position })
      .from(items)
      .where(
        and(
          eq(items.workspaceId, plan.workspaceId),
          parentId === null ? isNull(items.parentId) : eq(items.parentId, parentId),
          isNull(items.archivedAt),
        ),
      )
      .orderBy(sql`${items.position} desc`)
      .limit(1);
    lastKeyByParent.set(parentId, row?.position ?? null);
  }

  const pendingByParent = new Map<string | null, string[]>();
  for (const draft of drafts) {
    const parentKey = draft.parentId ?? null;
    if (!pendingByParent.has(parentKey)) {
      const count = drafts.filter((d) => (d.parentId ?? null) === parentKey).length;
      pendingByParent.set(parentKey, appendKeys(lastKeyByParent.get(parentKey) ?? null, count));
    }
  }
  const cursorByParent = new Map<string | null, number>();

  const entries: PlannedEntry[] = [];

  for (const draft of drafts) {
    const itemTypeId = draft.itemTypeId ?? defaultTypeId;
    if (!itemTypeId) throw new AppError('VALIDATION_ERROR', 'Creating an item needs an item type.');

    const fields = plan.fieldsByType.get(itemTypeId) ?? [];
    const id = crypto.randomUUID();
    const parentKey = draft.parentId ?? null;
    const parent = draft.parentId ? parentById.get(draft.parentId) : undefined;

    if (draft.parentId && !parent) {
      throw new AppError('NOT_FOUND', 'The parent item no longer exists.');
    }
    if (parent && (parent.isVariantModel || parent.variantParentId !== null)) {
      throw new AppError(
        'VARIANT_CONSTRAINT',
        'Products with variants cannot contain other items.',
      );
    }

    // Field defaults are applied before the draft's own values, so a paste
    // that leaves a column blank still lands on the type's default.
    const seeded: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.defaultValue !== null && field.defaultValue !== undefined) {
        seeded[field.key] = field.defaultValue;
      }
    }
    Object.assign(seeded, draft.values ?? {});

    const outcome = applyValuePatch({}, {}, seeded, fields, plan.coerceCtx);

    const cursor = cursorByParent.get(parentKey) ?? 0;
    cursorByParent.set(parentKey, cursor + 1);
    const position =
      pendingByParent.get(parentKey)?.[cursor] ?? keyBetween(lastKeyByParent.get(parentKey) ?? null, null);

    entries.push({
      before: null,
      after: {
        id,
        itemTypeId,
        title: draft.title,
        parentId: draft.parentId ?? null,
        path: childPath(parent?.path ?? null, id),
        position,
        isVariantModel: draft.isVariantModel ?? false,
        variantParentId: draft.variantParentId ?? null,
        variantAxisValues: draft.variantAxisValues ?? null,
        values: outcome.values,
        invalidValues: outcome.invalidValues,
        assigneeId: null,
        treeNodeIds: [...(draft.treeNodeIds ?? [])].sort(),
        deleted: false,
      },
      title: draft.title,
      skipped: false,
    });
  }

  return entries;
}

/** The `shared`-inheritance keys a set/clear would write on a variant, if any. */
function sharedKeysWrittenOnVariant(
  item: LoadedItem,
  input: ChangeSetInput,
  patch: Record<string, unknown>,
  fields: readonly Field[],
): string[] {
  if (item.variantParentId === null) return [];
  if (input.operation !== 'set_field' && input.operation !== 'clear_field') return [];

  const written =
    input.operation === 'set_field'
      ? Object.keys((patch.values ?? {}) as Record<string, unknown>)
      : ((patch.fieldKeys ?? []) as string[]);

  const byKey = new Map(fields.map((f) => [f.key, f]));
  return written.filter((key) => byKey.get(key)?.inheritance === 'shared');
}

function permissionActionFor(operation: ChangeOperation) {
  switch (operation) {
    case 'create':
      return 'item.create' as const;
    case 'delete':
      return 'item.delete' as const;
    case 'reparent':
      return 'item.reparent' as const;
    case 'assign_user':
      return 'item.assign' as const;
    case 'tree_assign':
    case 'tree_unassign':
      return 'tree_node.assign_items' as const;
    default:
      return 'item.update' as const;
  }
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

function buildSummary(operation: ChangeOperation, entries: readonly PlannedEntry[]): ChangeSummary {
  const summary: ChangeSummary = { byField: {} };
  const skipCounts = new Map<string, number>();

  let created = 0;
  let deleted = 0;
  let moved = 0;
  let assigned = 0;
  let unassigned = 0;
  let completenessBefore = 0;
  let completenessAfter = 0;
  let counted = 0;

  for (const entry of entries) {
    if (entry.skipped) {
      const reason = entry.skipReason ?? 'Skipped';
      skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
      continue;
    }

    if (entry.before === null && entry.after !== null) created += 1;
    if (entry.after === null) deleted += 1;
    if (entry.before && entry.after && entry.before.path !== entry.after.path) moved += 1;
    if (entry.before && entry.after && entry.before.assigneeId !== entry.after.assigneeId) {
      if (entry.after.assigneeId) assigned += 1;
      else unassigned += 1;
    }

    const beforeValues = entry.before?.values ?? {};
    const afterValues = entry.after?.values ?? {};
    const keys = new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)]);
    for (const key of keys) {
      const bucket = (summary.byField[key] ??= { changed: 0, unchanged: 0, invalid: 0 });
      if (entry.after && Object.prototype.hasOwnProperty.call(entry.after.invalidValues, key)) {
        bucket.invalid += 1;
      } else if (canonical(beforeValues[key]) !== canonical(afterValues[key])) {
        bucket.changed += 1;
      } else {
        bucket.unchanged += 1;
      }
    }

    counted += 1;
    completenessBefore += Object.keys(beforeValues).length;
    completenessAfter += Object.keys(afterValues).length;
  }

  if (created) summary.created = created;
  if (deleted) summary.deleted = deleted;
  if (moved) summary.moved = moved;
  if (assigned) summary.assigned = assigned;
  if (unassigned) summary.unassigned = unassigned;
  if (skipCounts.size > 0) {
    summary.skips = [...skipCounts].map(([reason, count]) => ({ reason, count }));
  }
  if (counted > 0 && operation !== 'delete') {
    summary.completenessDelta = { before: completenessBefore, after: completenessAfter };
  }

  return summary;
}

function buildSamples(entries: readonly PlannedEntry[]): SampleEntry[] {
  return entries.slice(0, SAMPLE_SIZE).map((entry) => ({
    itemId: entry.after?.id ?? entry.before?.id ?? null,
    title: entry.title,
    before: entry.before ? toSampleShape(entry.before) : null,
    after: entry.after ? toSampleShape(entry.after) : null,
    ...(entry.skipped ? { skipped: true, skipReason: entry.skipReason } : {}),
  }));
}

function toSampleShape(snapshot: ItemSnapshot): Record<string, unknown> {
  return {
    title: snapshot.title,
    values: snapshot.values,
    parentId: snapshot.parentId,
    assigneeId: snapshot.assigneeId,
    treeNodeIds: snapshot.treeNodeIds,
    itemTypeId: snapshot.itemTypeId,
  };
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

export async function previewChangeSet(
  tx: Tx,
  ctx: ChangeContext,
  input: ChangeSetInput,
): Promise<PreviewResult> {
  if (ctx.idempotencyKey) {
    const claim = await claimIdempotencyKey<{ changeSetId: string }>(
      `${ctx.workspaceId}:preview:${ctx.idempotencyKey}`,
    );
    if (!claim.claimed && claim.result) {
      const existing = await getChangeSet(tx, ctx.workspaceId, claim.result.changeSetId);
      return { changeSet: existing, requiresAsyncCommit: existing.itemCount > BULK_SYNC_THRESHOLD };
    }
  }

  const targetIds = await resolveTargetIds(tx, ctx.workspaceId, input.target, input.operation);

  if (targetIds.length > MAX_ITEMS_PER_CHANGE_SET) {
    throw new AppError(
      'TARGET_TOO_LARGE',
      `That would change ${targetIds.length.toLocaleString()} items. Narrow the selection to ${MAX_ITEMS_PER_CHANGE_SET.toLocaleString()} or fewer.`,
      { count: targetIds.length, limit: MAX_ITEMS_PER_CHANGE_SET },
    );
  }

  const loaded = await loadItems(tx, ctx.workspaceId, targetIds);
  if (input.operation !== 'create' && loaded.length === 0) {
    throw new AppError('NOT_FOUND', 'None of those items still exist.');
  }

  const typeIds = new Set<string>(loaded.map((i) => i.itemTypeId));
  if (input.itemTypeId) typeIds.add(input.itemTypeId);
  if (typeof input.patch?.itemTypeId === 'string') typeIds.add(input.patch.itemTypeId);
  for (const draft of (input.target.drafts ?? []) as ItemDraft[]) {
    if (draft.itemTypeId) typeIds.add(draft.itemTypeId);
  }

  const [fieldsByType, coerceCtx, treeNodePaths] = await Promise.all([
    loadFieldsByType(tx, ctx.workspaceId, [...typeIds]),
    buildCoerceContext(tx, ctx.workspaceId),
    loadTreeNodePaths(tx, ctx.workspaceId, targetIds),
  ]);

  const patch = { ...(input.patch ?? {}) };

  // Reparent needs the moving root's old and new paths available to every
  // descendant entry, so compute them once here rather than per row.
  if (input.operation === 'reparent') {
    const rootId = (patch.itemId as string | undefined) ?? input.target.itemIds?.[0];
    const root = loaded.find((i) => i.id === rootId);
    if (!root) throw new AppError('VALIDATION_ERROR', 'The item being moved is not in the selection.');
    const newParentId = (patch.parentId ?? null) as string | null;
    let newParentPath: string | null = null;
    if (newParentId) {
      const [parent] = await loadItems(tx, ctx.workspaceId, [newParentId]);
      if (!parent) throw new AppError('NOT_FOUND', 'The destination item no longer exists.');
      newParentPath = parent.path;
    }
    patch.itemId = root.id;
    patch.__oldRootPath = root.path;
    patch.__newRootPath = childPath(newParentPath, root.id);
  }

  const plan: PlanContext = {
    tx,
    workspaceId: ctx.workspaceId,
    actor: ctx.actor,
    fieldsByType,
    coerceCtx,
    treeNodePaths,
  };

  const planned = await planEntries(plan, { ...input, patch }, loaded);

  const applied = planned.filter((e) => !e.skipped);
  const skipped = planned.filter((e) => e.skipped);

  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000);

  const [created] = await tx
    .insert(changeSets)
    .values({
      workspaceId: ctx.workspaceId,
      operation: input.operation,
      status: 'preview',
      source: ctx.source ?? 'user',
      itemTypeId: input.itemTypeId ?? loaded[0]?.itemTypeId ?? null,
      actorId: ctx.actor.userId,
      actorApiKeyId: ctx.actor.apiKey?.id ?? null,
      target: input.target,
      patch,
      itemCount: applied.length,
      skippedCount: skipped.length,
      summary: buildSummary(input.operation, planned),
      sampleEntries: buildSamples(planned),
      idempotencyKey: ctx.idempotencyKey ?? null,
      expiresAt,
    })
    .returning();

  if (!created) throw new AppError('INTERNAL_ERROR', 'Could not create the change set.');

  if (planned.length > 0) {
    const rows = planned.map((entry, seq) => ({
      workspaceId: ctx.workspaceId,
      changeSetId: created.id,
      itemId: entry.before?.id ?? entry.after?.id ?? null,
      seq,
      before: entry.before as unknown as Record<string, unknown> | null,
      after: entry.after as unknown as Record<string, unknown> | null,
      skipped: entry.skipped,
      skipReason: entry.skipReason ?? null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(changeEntries).values(rows.slice(i, i + 500));
    }
  }

  if (ctx.idempotencyKey) {
    await completeIdempotencyKey(`${ctx.workspaceId}:preview:${ctx.idempotencyKey}`, {
      changeSetId: created.id,
    });
  }

  return { changeSet: created, requiresAsyncCommit: applied.length > BULK_SYNC_THRESHOLD };
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

export async function commitChangeSet(
  tx: Tx,
  ctx: ChangeContext,
  changeSetId: string,
): Promise<CommitResult> {
  const changeSet = await getChangeSet(tx, ctx.workspaceId, changeSetId);

  if (changeSet.status === 'committed') {
    throw new AppError('ALREADY_COMMITTED', 'That change has already been applied.');
  }
  if (changeSet.status !== 'preview' && changeSet.status !== 'committing') {
    throw new AppError(
      'ALREADY_COMMITTED',
      `This change is ${changeSet.status} and can no longer be applied.`,
    );
  }
  if (changeSet.expiresAt && changeSet.expiresAt.getTime() < Date.now()) {
    await tx.update(changeSets).set({ status: 'expired' }).where(eq(changeSets.id, changeSetId));
    throw new AppError(
      'STALE_PREVIEW',
      'This preview has expired. Re-run it to see the current state before applying.',
    );
  }

  const entries = await tx
    .select()
    .from(changeEntries)
    .where(
      and(eq(changeEntries.workspaceId, ctx.workspaceId), eq(changeEntries.changeSetId, changeSetId)),
    )
    .orderBy(changeEntries.seq);

  const live = entries.filter((e) => !e.skipped);
  const itemIds = live
    .map((e) => (e.before as ItemSnapshot | null)?.id)
    .filter((id): id is string => Boolean(id));

  // --- staleness -----------------------------------------------------------
  const current = await loadItems(tx, ctx.workspaceId, itemIds, { includeDeleted: true });
  const currentById = new Map(current.map((i) => [i.id, snapshotOf(i)]));

  const stale: string[] = [];
  for (const entry of live) {
    const before = entry.before as ItemSnapshot | null;
    if (before === null) continue;
    const now = currentById.get(before.id) ?? null;
    if (!snapshotsEqual(before, now)) stale.push(before.id);
  }

  if (stale.length > 0) {
    // Deliberately not auto-retried and deliberately all-or-nothing: a preview
    // the user read and approved no longer describes reality, and applying
    // "most of it" is how one person's edit silently erases another's.
    await tx
      .update(changeSets)
      .set({
        status: 'failed',
        error: {
          code: 'STALE_PREVIEW',
          message: `${stale.length} item(s) changed since the preview.`,
          details: { itemIds: stale.slice(0, 20) },
        },
      })
      .where(eq(changeSets.id, changeSetId));

    throw new AppError(
      'STALE_PREVIEW',
      `${stale.length} item${stale.length === 1 ? '' : 's'} changed since you previewed this. Refresh to see the current values.`,
      { staleCount: stale.length, itemIds: stale.slice(0, 20) },
    );
  }

  await tx.update(changeSets).set({ status: 'committing' }).where(eq(changeSets.id, changeSetId));

  // --- apply ---------------------------------------------------------------
  const typeIds = new Set<string>();
  for (const entry of live) {
    const before = entry.before as ItemSnapshot | null;
    const after = entry.after as ItemSnapshot | null;
    if (before) typeIds.add(before.itemTypeId);
    if (after) typeIds.add(after.itemTypeId);
  }
  const fieldsByType = await loadFieldsByType(tx, ctx.workspaceId, [...typeIds]);

  const applyCtx: ApplyContext = {
    workspaceId: ctx.workspaceId,
    actorId: ctx.actor.userId,
    fieldsByType,
  };

  const changes = live.map((e) => ({
    before: e.before as ItemSnapshot | null,
    after: e.after as ItemSnapshot | null,
    hardDelete: e.hardDelete,
  }));

  const { touchedIds, fullReprojectIds } = await applySnapshots(tx, applyCtx, changes);
  const { variantsTouched } = await recomputeDerived(
    tx,
    applyCtx,
    touchedIds,
    fullReprojectIds,
  );

  await refreshItemTypeCounts(tx, ctx.workspaceId, [...typeIds]);

  const [committed] = await tx
    .update(changeSets)
    .set({ status: 'committed', committedAt: new Date(), progress: 100, error: null })
    .where(eq(changeSets.id, changeSetId))
    .returning();

  if (!committed) throw new AppError('INTERNAL_ERROR', 'Change set vanished mid-commit.');

  return {
    changeSet: committed,
    appliedCount: live.length,
    skippedCount: entries.length - live.length,
    variantsPropagated: variantsTouched.length,
  };
}

async function refreshItemTypeCounts(
  tx: Tx,
  workspaceId: string,
  typeIds: readonly string[],
): Promise<void> {
  if (typeIds.length === 0) return;
  await tx.execute(sql`
    update item_types t
    set item_count = coalesce(c.n, 0)
    from (
      select it.id, count(i.id)::int as n
      from item_types it
      left join items i on i.item_type_id = it.id and i.archived_at is null
      where it.workspace_id = ${workspaceId}
        and it.id in ${sql`(${sql.join(typeIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
      group by it.id
    ) c
    where t.id = c.id
  `);
}

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

export async function undoChangeSet(
  tx: Tx,
  ctx: ChangeContext,
  changeSetId: string,
): Promise<CommitResult> {
  const original = await getChangeSet(tx, ctx.workspaceId, changeSetId);

  if (original.status === 'undone') {
    throw new AppError('ALREADY_UNDONE', 'That change has already been undone.');
  }
  if (original.status !== 'committed') {
    throw new AppError(
      'OPERATION_NOT_APPLICABLE',
      `A change that is ${original.status} cannot be undone.`,
    );
  }

  const decision = can(ctx.actor, 'change_set.undo', {
    kind: 'change_set',
    actorId: original.actorId,
    source: original.source,
  });
  if (decision !== true) throw new AppError(decision.code, decision.message, decision.details);

  const entries = await tx
    .select()
    .from(changeEntries)
    .where(
      and(eq(changeEntries.workspaceId, ctx.workspaceId), eq(changeEntries.changeSetId, changeSetId)),
    )
    .orderBy(changeEntries.seq);

  const live = entries.filter((e) => !e.skipped);

  const [inverse] = await tx
    .insert(changeSets)
    .values({
      workspaceId: ctx.workspaceId,
      operation: original.operation,
      status: 'preview',
      source: 'undo',
      itemTypeId: original.itemTypeId,
      actorId: ctx.actor.userId,
      actorApiKeyId: ctx.actor.apiKey?.id ?? null,
      target: original.target,
      patch: original.patch,
      itemCount: live.length,
      parentChangeSetId: original.id,
      summary: { byField: {} },
      sampleEntries: [],
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MINUTES * 60_000),
    })
    .returning();

  if (!inverse) throw new AppError('INTERNAL_ERROR', 'Could not create the undo change set.');

  if (live.length > 0) {
    // The inverse is a plain swap. Undo is applied in reverse order so that a
    // set which created a parent and then its children removes the children
    // first — the reverse of the order that made them.
    const rows = [...live].reverse().map((entry, seq) => ({
      workspaceId: ctx.workspaceId,
      changeSetId: inverse.id,
      itemId: entry.itemId,
      seq,
      before: entry.after,
      after: entry.before,
      skipped: false,
      skipReason: null,
      // The item did not exist before the original entry, so undoing it should
      // leave no trace rather than a tombstone nobody can see or clean up.
      hardDelete: entry.before === null && entry.after !== null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(changeEntries).values(rows.slice(i, i + 500));
    }
  }

  const result = await commitChangeSet(tx, { ...ctx, source: 'undo' }, inverse.id);

  await tx
    .update(changeSets)
    .set({ status: 'undone', undoneAt: new Date(), undoneByChangeSetId: inverse.id })
    .where(eq(changeSets.id, original.id));

  return result;
}

// ---------------------------------------------------------------------------
// convenience
// ---------------------------------------------------------------------------

/**
 * Preview and commit in one transaction.
 *
 * This is the single-item path: a cell edit, a drag, a checkbox. It skips the
 * preview *modal*, not the preview *record* — the change set still exists, so
 * the edit shows in activity and undoes exactly like a bulk edit does.
 */
export async function applyImmediate(
  ctx: ChangeContext,
  input: ChangeSetInput,
): Promise<CommitResult> {
  return withWorkspace(ctx.workspaceId, async (tx) => {
    const { changeSet } = await previewChangeSet(tx, ctx, input);
    return commitChangeSet(tx, ctx, changeSet.id);
  });
}

export async function getChangeSet(
  tx: Tx,
  workspaceId: string,
  changeSetId: string,
): Promise<ChangeSet> {
  const [row] = await tx
    .select()
    .from(changeSets)
    .where(and(eq(changeSets.workspaceId, workspaceId), eq(changeSets.id, changeSetId)))
    .limit(1);

  if (!row) throw new AppError('NOT_FOUND', 'That change no longer exists.');
  return row;
}

export async function listChangeSets(
  tx: Tx,
  workspaceId: string,
  opts: { limit?: number; actorId?: string; itemTypeId?: string } = {},
): Promise<ChangeSet[]> {
  return tx
    .select()
    .from(changeSets)
    .where(
      and(
        eq(changeSets.workspaceId, workspaceId),
        opts.actorId ? eq(changeSets.actorId, opts.actorId) : undefined,
        opts.itemTypeId ? eq(changeSets.itemTypeId, opts.itemTypeId) : undefined,
        inArray(changeSets.status, ['committed', 'undone']),
      ),
    )
    .orderBy(sql`${changeSets.createdAt} desc`)
    .limit(opts.limit ?? 50);
}

export async function discardPreview(
  tx: Tx,
  workspaceId: string,
  changeSetId: string,
): Promise<void> {
  const changeSet = await getChangeSet(tx, workspaceId, changeSetId);
  if (changeSet.status !== 'preview') {
    throw new AppError('ALREADY_COMMITTED', 'Only an unapplied preview can be discarded.');
  }
  await tx.delete(changeSets).where(eq(changeSets.id, changeSetId));
}
