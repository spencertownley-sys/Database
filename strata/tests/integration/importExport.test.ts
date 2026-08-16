/**
 * Import / export (Step 11).
 *
 * The invariants under test: the dry-run report tells the truth (counts,
 * match-key accounting, non-blocking invalid cells), the commit is ONE change
 * set whose undo restores a byte-identical workspace, match-key re-imports
 * update instead of duplicating, and an exported view re-imports with no data
 * loss — the §11 round-trip acceptance criterion.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { and, eq, like } from 'drizzle-orm';
import { asWorkspace, closeTestDb, ownerClient, workspaceIdBySlug } from './helpers/db';
import { snapshotWorkspace } from './helpers/workspaceSnapshot';
import {
  buildImportDrafts,
  createImportJob,
  getImportJob,
  guardCsvCell,
  markCommitted,
  setMappingAndValidate,
  suggestMappings,
} from '@/server/services/imports.service';
import { runExport } from '@/server/services/exports.service';
import { getFile, signDownloadToken, verifyDownloadToken } from '@/server/lib/storage';
import {
  commitChangeSet,
  previewChangeSet,
  undoChangeSet,
  type ChangeContext,
} from '@/server/services/changeSets.service';
import type { Actor } from '@/server/services/permissions.service';
import { items } from '@/server/db/schema/items';
import { itemTypes } from '@/server/db/schema/itemTypes';

let workspaceId: string;
let actor: Actor;
let taskTypeId: string;

const PREFIX = 'ImportRT';

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');
  const [member] = await ownerClient<Array<{ id: string; user_id: string }>>`
    select id, user_id from workspace_members
    where workspace_id = ${workspaceId} and role = 'owner' limit 1
  `;
  if (!member) throw new Error('Seed missing an owner. Run `npm run db:seed`.');
  actor = { userId: member.user_id, workspaceId, memberId: member.id, role: 'owner' };

  const [task] = await asWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: itemTypes.id })
      .from(itemTypes)
      .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.key, 'task')))
      .limit(1),
  );
  if (!task) throw new Error('Seed missing the task type.');
  taskTypeId = task.id;
});

afterAll(async () => {
  await ownerClient`delete from items where workspace_id = ${workspaceId} and title like ${PREFIX + '%'}`;
  await closeTestDb();
});

function ctx(): ChangeContext {
  return { workspaceId, actor, source: 'import' };
}

async function commitJob(jobId: string): Promise<string> {
  return asWorkspace(workspaceId, async (tx) => {
    const job = await getImportJob(tx, workspaceId, jobId);
    const drafts = await buildImportDrafts(tx, workspaceId, job);
    const { changeSet } = await previewChangeSet(tx, ctx(), {
      operation: 'create',
      itemTypeId: job.itemTypeId,
      target: { kind: 'new', drafts },
    });
    await commitChangeSet(tx, ctx(), changeSet.id);
    await markCommitted(tx, workspaceId, job.id, changeSet.id);
    return changeSet.id;
  });
}

describe('mapping suggestions', () => {
  it('matches exact labels confidently and guesses near names', () => {
    const fields = [
      { key: 'status', label: 'Status' },
      { key: 'due_date', label: 'Due date' },
      { key: 'estimate_hours', label: 'Estimate (hours)' },
    ];
    const suggestions = suggestMappings(
      ['Task Name', 'Status', 'Deadline Date', 'Estimate'],
      fields,
      [['Fix login', 'To do', '2026-09-01', '4']],
    );

    expect(suggestions[0]?.suggestedFieldKey).toBe('title');
    expect(suggestions[1]).toMatchObject({ suggestedFieldKey: 'status', confidence: 1 });
    expect(suggestions[2]?.suggestedFieldKey).toBe('due_date');
    expect(suggestions[3]?.suggestedFieldKey).toBe('estimate_hours');
  });

  it('never suggests the same field for two columns', () => {
    const suggestions = suggestMappings(
      ['Status', 'Status (old)'],
      [{ key: 'status', label: 'Status' }],
      [],
    );
    const targets = suggestions.map((s) => s.suggestedFieldKey).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe('csv injection guard', () => {
  it('defuses formula-leading cells and leaves the rest alone', () => {
    expect(guardCsvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(guardCsvCell('+1234')).toBe("'+1234");
    expect(guardCsvCell('-2')).toBe("'-2");
    expect(guardCsvCell('@handle')).toBe("'@handle");
    expect(guardCsvCell('plain value')).toBe('plain value');
  });
});

describe('download tokens', () => {
  it('round-trips and rejects tampering', () => {
    const token = signDownloadToken('exports/ws/file.csv', 'ws-1');
    expect(verifyDownloadToken(token)).toEqual({
      storagePath: 'exports/ws/file.csv',
      workspaceId: 'ws-1',
    });
    expect(() => verifyDownloadToken(`${token.slice(0, -2)}xx`)).toThrowError(/not valid/);
    expect(() => verifyDownloadToken('garbage')).toThrowError(/not valid/);
  });
});

describe('import flow', () => {
  it('uploads, validates honestly, commits one undoable change set', async () => {
    const csv = Papa.unparse({
      fields: ['Task', 'Status', 'Due', 'Hours'],
      data: [
        [`${PREFIX} alpha`, 'To do', '2026-09-01', '4'],
        [`${PREFIX} beta`, 'In progress', '2026-09-08', 'not-a-number'],
        [`${PREFIX} gamma`, 'Done', '', '2.5'],
      ],
    });

    const before = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));

    const { job, detectedColumns } = await asWorkspace(workspaceId, (tx) =>
      createImportJob(tx, workspaceId, actor.userId, {
        itemTypeId: taskTypeId,
        fileName: 'tasks.csv',
        mimeType: 'text/csv',
        content: Buffer.from(csv),
      }),
    );
    expect(job.rowCount).toBe(3);
    expect(detectedColumns.find((c) => c.name === 'Task')?.suggestedFieldKey).toBe('title');

    const validated = await asWorkspace(workspaceId, (tx) =>
      setMappingAndValidate(tx, workspaceId, actor.userId, job.id, {
        mapping: { Task: 'title', Status: 'status', Due: 'due_date', Hours: 'estimate_hours' },
      }),
    );
    expect(validated.status).toBe('validated');
    expect(validated.newCount).toBe(3);
    expect(validated.errorCount).toBe(1); // "not-a-number"
    expect(validated.errorCsvPath).toBeTruthy();

    const errorCsv = (await getFile(validated.errorCsvPath as string)).toString('utf8');
    expect(errorCsv).toContain('not-a-number');

    const changeSetId = await commitJob(job.id);

    const created = await asWorkspace(workspaceId, (tx) =>
      tx
        .select()
        .from(items)
        .where(and(eq(items.workspaceId, workspaceId), like(items.title, `${PREFIX} %`))),
    );
    expect(created).toHaveLength(3);

    const beta = created.find((i) => i.title === `${PREFIX} beta`);
    // Non-blocking validation: the bad cell is quarantined, the row commits.
    expect(beta?.invalidValues).toHaveProperty('estimate_hours');
    expect((beta?.values as Record<string, unknown>).status).toBe('in_progress');

    // One undo reverts the entire import to a byte-identical workspace.
    await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));
    const after = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
    expect(after).toStrictEqual(before);
  });

  it('match-key re-import updates instead of duplicating', async () => {
    const first = Papa.unparse({
      fields: ['Task', 'Hours'],
      data: [
        [`${PREFIX} match-a`, '1'],
        [`${PREFIX} match-b`, '2'],
      ],
    });
    const { job: job1 } = await asWorkspace(workspaceId, (tx) =>
      createImportJob(tx, workspaceId, actor.userId, {
        itemTypeId: taskTypeId,
        fileName: 'first.csv',
        mimeType: 'text/csv',
        content: Buffer.from(first),
      }),
    );
    await asWorkspace(workspaceId, (tx) =>
      setMappingAndValidate(tx, workspaceId, actor.userId, job1.id, {
        mapping: { Task: 'title', Hours: 'estimate_hours' },
      }),
    );
    await commitJob(job1.id);

    // Second pass: same titles, changed hours, one new row.
    const second = Papa.unparse({
      fields: ['Task', 'Hours'],
      data: [
        [`${PREFIX} match-a`, '10'],
        [`${PREFIX} match-b`, '20'],
        [`${PREFIX} match-c`, '30'],
      ],
    });
    const { job: job2 } = await asWorkspace(workspaceId, (tx) =>
      createImportJob(tx, workspaceId, actor.userId, {
        itemTypeId: taskTypeId,
        fileName: 'second.csv',
        mimeType: 'text/csv',
        content: Buffer.from(second),
      }),
    );
    const validated = await asWorkspace(workspaceId, (tx) =>
      setMappingAndValidate(tx, workspaceId, actor.userId, job2.id, {
        mapping: { Task: 'title', Hours: 'estimate_hours' },
        matchKey: 'title',
      }),
    );
    expect(validated.matchedCount).toBe(2);
    expect(validated.newCount).toBe(1);

    await commitJob(job2.id);

    const rows = await asWorkspace(workspaceId, (tx) =>
      tx
        .select({ title: items.title, values: items.values })
        .from(items)
        .where(and(eq(items.workspaceId, workspaceId), like(items.title, `${PREFIX} match-%`))),
    );
    expect(rows).toHaveLength(3); // updated in place, not duplicated
    const a = rows.find((r) => r.title === `${PREFIX} match-a`);
    expect((a?.values as Record<string, unknown>).estimate_hours).toBe(10);
  });

  it('rejects binary masquerading as CSV', async () => {
    await expect(
      asWorkspace(workspaceId, (tx) =>
        createImportJob(tx, workspaceId, actor.userId, {
          itemTypeId: taskTypeId,
          fileName: 'sneaky.csv',
          mimeType: 'text/csv',
          content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), // zip magic = xlsx
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });
});

describe('round trip', () => {
  const ROWS = 5_000;

  it(
    `${ROWS} rows out and back in with no data loss, then undo`,
    { timeout: 300_000 },
    async () => {
      // Seed via one import — also exercises the bulk path end to end.
      const sourceRows = Array.from({ length: ROWS }, (_, i) => [
        `${PREFIX} rt-${String(i).padStart(4, '0')}`,
        i % 3 === 0 ? 'To do' : i % 3 === 1 ? 'In progress' : 'Done',
        String((i % 40) + 0.5),
      ]);
      const seedCsv = Papa.unparse({ fields: ['Task', 'Status', 'Hours'], data: sourceRows });

      const { job: seedJob } = await asWorkspace(workspaceId, (tx) =>
        createImportJob(tx, workspaceId, actor.userId, {
          itemTypeId: taskTypeId,
          fileName: 'seed.csv',
          mimeType: 'text/csv',
          content: Buffer.from(seedCsv),
        }),
      );
      await asWorkspace(workspaceId, (tx) =>
        setMappingAndValidate(tx, workspaceId, actor.userId, seedJob.id, {
          mapping: { Task: 'title', Status: 'status', Hours: 'estimate_hours' },
        }),
      );
      await commitJob(seedJob.id);

      // Export exactly those rows (search narrows to the round-trip prefix).
      const { job: exportJob } = await asWorkspace(workspaceId, (tx) =>
        runExport(tx, workspaceId, actor.userId, {
          itemTypeId: taskTypeId,
          search: `${PREFIX} rt-`,
          visibleFieldKeys: ['status', 'estimate_hours'],
        }),
      );
      expect(exportJob.rowCount).toBe(ROWS);

      const exported = (await getFile(exportJob.storagePath as string)).toString('utf8');
      const parsed = Papa.parse<string[]>(exported, { skipEmptyLines: 'greedy' });
      expect(parsed.data).toHaveLength(ROWS + 1); // header + rows

      // Re-import the exported file against the same items by title.
      const before = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
      const { job: rtJob } = await asWorkspace(workspaceId, (tx) =>
        createImportJob(tx, workspaceId, actor.userId, {
          itemTypeId: taskTypeId,
          fileName: 'roundtrip.csv',
          mimeType: 'text/csv',
          content: Buffer.from(exported),
        }),
      );
      const validated = await asWorkspace(workspaceId, (tx) =>
        setMappingAndValidate(tx, workspaceId, actor.userId, rtJob.id, {
          mapping: { Title: 'title', Status: 'status', 'Estimate (hours)': 'estimate_hours' },
          matchKey: 'title',
        }),
      );

      // No data loss: every exported row matches an existing item, none is
      // new, and no cell fails to coerce back.
      expect(validated.matchedCount).toBe(ROWS);
      expect(validated.newCount).toBe(0);
      expect(validated.errorCount).toBe(0);

      const changeSetId = await commitJob(rtJob.id);

      // The re-import wrote the same values back — the workspace items table
      // is unchanged except updated_at (excluded from the snapshot).
      const after = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
      expect(after).toStrictEqual(before);

      // And the whole thing undoes cleanly.
      await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));
      const undone = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
      expect(undone).toStrictEqual(before);
    },
  );
});
