/**
 * Wire schemas shared by `/api/v1` and the app's own client.
 *
 * The app calls the same routes customers do, so these are the only definition
 * of what a valid request looks like — there is no internal shape that skips
 * validation. The OpenAPI document is generated from exactly these.
 */

import { z } from 'zod';
import { FILTER_OPERATORS } from '@/types/filters';
import { FIELD_TYPES } from '@/types/fields';
import { USER_OPERATIONS } from '@/server/db/schema/changeSets';

export const uuidSchema = z.string().uuid();

export const filterClauseSchema: z.ZodType<{
  field: string;
  operator: (typeof FILTER_OPERATORS)[number];
  value?: unknown;
  includeDescendants?: boolean;
}> = z.object({
  field: z.string().min(1).max(80),
  // z.enum needs a mutable non-empty tuple; the source lists are `as const`.
  operator: z.enum(FILTER_OPERATORS as unknown as [string, ...string[]]),
  value: z.unknown().optional(),
  includeDescendants: z.boolean().optional(),
});

export interface FilterGroupInput {
  operator: 'and' | 'or';
  clauses: Array<z.infer<typeof filterClauseSchema> | FilterGroupInput>;
}

export const filterGroupSchema: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({
    operator: z.enum(['and', 'or']),
    clauses: z.array(z.union([filterClauseSchema, filterGroupSchema])).max(100),
  }),
);

export const sortSchema = z.object({
  field: z.string().min(1).max(80),
  direction: z.enum(['asc', 'desc']),
  nulls: z.enum(['first', 'last']).optional(),
});

export const groupSchema = z.object({
  field: z.string().min(1).max(80),
  direction: z.enum(['asc', 'desc']).default('asc'),
  collapsed: z.array(z.string()).optional(),
});

/** Query parameters arrive as strings, so JSON-valued params are parsed here. */
const jsonParam = <S extends z.ZodTypeAny>(schema: S) =>
  z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be valid JSON.' });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const listItemsQuerySchema = z.object({
  workspace: z.string().optional(),
  itemType: uuidSchema.optional(),
  filter: jsonParam(filterGroupSchema).optional(),
  sort: jsonParam(z.array(sortSchema).max(8)).optional(),
  search: z.string().max(200).optional(),
  under: uuidSchema.optional(),
  treeNode: uuidSchema.optional(),
  treeIncludeDescendants: z.coerce.boolean().optional(),
  incompleteOnly: z.coerce.boolean().optional(),
  includeVariants: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(4000).optional(),
  withTotal: z.coerce.boolean().optional(),
});

export const itemDraftSchema = z.object({
  title: z.string().max(500).default(''),
  values: z.record(z.unknown()).optional(),
  parentId: uuidSchema.nullable().optional(),
  treeNodeIds: z.array(uuidSchema).max(50).optional(),
  itemTypeId: uuidSchema.optional(),
});

export const changeTargetSchema = z.object({
  kind: z.enum(['ids', 'filter', 'subtree', 'new']),
  itemIds: z.array(uuidSchema).max(50_000).optional(),
  filter: filterGroupSchema.optional(),
  rootItemId: uuidSchema.optional(),
  includeDescendants: z.boolean().optional(),
  drafts: z.array(itemDraftSchema).max(5_000).optional(),
});

export const changeSetInputSchema = z.object({
  operation: z.enum(USER_OPERATIONS),
  itemTypeId: uuidSchema.optional(),
  target: changeTargetSchema,
  patch: z.record(z.unknown()).default({}),
  /** Skip the preview modal for a single-item write. Server still records one. */
  autoCommit: z.boolean().optional(),
});

export const createItemTypeSchema = z.object({
  name: z.string().min(1).max(120),
  presetKey: z.string().max(60).optional(),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/, 'Use lowercase letters, digits and underscores.')
    .optional(),
  description: z.string().max(1000).optional(),
  icon: z.string().max(60).optional(),
  color: z.string().max(30).optional(),
});

export const createFieldSchema = z.object({
  itemTypeId: uuidSchema,
  label: z.string().min(1).max(120),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .optional(),
  type: z.enum(FIELD_TYPES),
  config: z.record(z.unknown()).default({}),
  required: z.boolean().default(false),
  inheritance: z.enum(['shared', 'variant']).default('variant'),
  helpText: z.string().max(500).optional(),
  fieldGroupId: uuidSchema.nullable().optional(),
  defaultValue: z.unknown().optional(),
  countsTowardCompleteness: z.boolean().default(true),
  isSearchable: z.boolean().default(false),
  /**
   * Required when adding a required field to a type that already has items:
   * doing so silently drops everyone's completeness overnight, and a metric
   * that moves for reasons the user did not cause is one they stop trusting.
   */
  acknowledgeIncomplete: z.boolean().optional(),
});

export const updateFieldSchema = createFieldSchema
  .partial()
  .omit({ itemTypeId: true })
  .extend({
    /** Retyping needs an explicit confirmation of the conversion preview. */
    confirmConversion: z.boolean().optional(),
  });

export const viewConfigSchema = z.object({
  filter: filterGroupSchema.optional(),
  sort: z.array(sortSchema).max(8).optional(),
  group: groupSchema.optional(),
  search: z.string().max(200).optional(),
  incompleteOnly: z.boolean().optional(),
  visibleFieldKeys: z.array(z.string()).max(200).optional(),
  columnWidths: z.record(z.number().min(40).max(1200)).optional(),
  pinnedFieldKeys: z.array(z.string()).max(10).optional(),
  rowHeight: z.enum(['compact', 'normal', 'tall']).optional(),
  boardGroupFieldKey: z.string().optional(),
  boardColumnOrder: z.array(z.string()).optional(),
  boardWipLimits: z.record(z.number().int().min(0)).optional(),
  treeNodeId: uuidSchema.optional(),
  treeIncludeDescendants: z.boolean().optional(),
});

export const createViewSchema = z.object({
  itemTypeId: uuidSchema,
  name: z.string().min(1).max(120),
  kind: z.enum(['grid', 'list', 'board']).default('grid'),
  visibility: z.enum(['private', 'workspace', 'shared']).default('private'),
  config: viewConfigSchema.default({}),
});
