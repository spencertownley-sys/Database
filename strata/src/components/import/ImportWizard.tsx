'use client';

/**
 * The four-step import wizard (UI/UX §9.5): ① Upload ② Map ③ Check ④ Done.
 *
 * The dry-run report between mapping and commit is the whole point — nobody
 * commits 4,000 rows on faith. Matched/guessed/skipped mapping states use the
 * ●/◐/○ markers from the spec so confidence is visible per column, and the
 * final step surfaces the change set id: an import undoes like any other edit.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, setWorkspaceId, type ImportJobWire } from '@/lib/api';
import type { Field } from '@/server/db/schema/itemTypes';

interface ImportWizardProps {
  workspaceId: string;
  itemTypes: Array<{ id: string; label: string; pluralLabel: string | null }>;
  /** Live fields per item type id, for the mapping dropdowns. */
  fieldsByType: Record<string, Array<Pick<Field, 'key' | 'label'>>>;
}

type StepId = 'upload' | 'map' | 'check' | 'done';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map' },
  { id: 'check', label: 'Check' },
  { id: 'done', label: 'Done' },
];

export function ImportWizard(props: ImportWizardProps) {
  setWorkspaceId(props.workspaceId);

  const [step, setStep] = useState<StepId>('upload');
  const [itemTypeId, setItemTypeId] = useState(props.itemTypes[0]?.id ?? '');
  const [job, setJob] = useState<ImportJobWire | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [matchKey, setMatchKey] = useState<string>('');
  const [profileName, setProfileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ['import-profiles', props.workspaceId, itemTypeId],
    queryFn: ({ signal }) => api.importProfiles.list(itemTypeId, signal),
    enabled: Boolean(itemTypeId),
  });

  const fields = useMemo(
    () => props.fieldsByType[itemTypeId] ?? [],
    [props.fieldsByType, itemTypeId],
  );

  const upload = async (file: File, profileId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.imports.create(file, itemTypeId, profileId);
      setJob(created);
      const initial: Record<string, string> = {};
      const conf: Record<string, number> = {};
      for (const column of created.detectedColumns ?? []) {
        initial[column.name] =
          created.mapping[column.name] ?? column.suggestedFieldKey ?? '$skip';
        conf[column.name] = created.mapping[column.name] ? 1 : column.confidence;
      }
      setMapping(initial);
      setConfidence(conf);
      setMatchKey(created.matchKey ?? '');
      setStep('map');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const validated = await api.imports.setMapping(job.id, {
        mapping,
        matchKey: matchKey || null,
        saveAsProfile: profileName.trim() || undefined,
      });
      setJob(validated);
      setStep('check');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Validation failed.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const committed = await api.imports.commit(job.id);
      setJob(committed);
      setStep('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The commit failed.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!job?.changeSetId) return;
    setBusy(true);
    try {
      await api.changeSets.undo(job.changeSetId);
      setJob({ ...job, changeSetId: null });
      setError('Import undone — every created and updated item was reverted.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The undo failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-6 py-6">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Import</h1>
        <ol className="flex items-center gap-2 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => {
            const activeIndex = STEPS.findIndex((x) => x.id === step);
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
            return (
              <li
                key={s.id}
                aria-current={state === 'active' ? 'step' : undefined}
                className={
                  state === 'active'
                    ? 'rounded-full bg-[var(--color-primary)] px-2.5 py-1 text-white'
                    : state === 'done'
                      ? 'rounded-full bg-[var(--color-muted)] px-2.5 py-1'
                      : 'rounded-full px-2.5 py-1 text-[var(--color-ink-subtle)]'
                }
              >
                {i + 1} {s.label}
              </li>
            );
          })}
        </ol>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {step === 'upload' && (
        <section aria-label="Upload">
          <label className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
            Import into
          </label>
          <select
            className="mb-4 w-64 rounded border bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            value={itemTypeId}
            onChange={(e) => setItemTypeId(e.target.value)}
          >
            {props.itemTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.pluralLabel ?? t.label}
              </option>
            ))}
          </select>

          {(profiles?.data.length ?? 0) > 0 && (
            <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
              Saved profiles apply their mapping automatically — pick the file and choose the
              profile when prompted, or just upload to map by hand.
            </p>
          )}

          <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]">
            <span>{busy ? 'Uploading…' : 'Drop a CSV here, or click to choose'}</span>
            <span className="text-xs text-[var(--color-ink-subtle)]">
              CSV up to 50MB · 10,000 rows. Exporting from Excel? Save As → CSV UTF-8.
            </span>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              disabled={busy || !itemTypeId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const profile = profiles?.data.find((p) => p.itemTypeId === itemTypeId);
                void upload(file, profile?.id);
              }}
            />
          </label>
        </section>
      )}

      {step === 'map' && job && (
        <section aria-label="Map columns">
          <p className="mb-3 text-sm text-[var(--color-ink-muted)]">
            {job.fileName} · {job.rowCount.toLocaleString()} rows ·{' '}
            {(job.detectedHeaders ?? []).length} columns
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-subtle)]">
                <th className="py-1 pr-3 font-medium">Source column</th>
                <th className="py-1 pr-3 font-medium">Sample</th>
                <th className="py-1 font-medium">Field</th>
              </tr>
            </thead>
            <tbody>
              {(job.detectedColumns ?? []).map((column) => {
                const target = mapping[column.name] ?? '$skip';
                const conf = confidence[column.name] ?? 0;
                const marker =
                  target === '$skip' ? '○' : conf >= 0.9 ? '●' : conf > 0 ? '◐' : '●';
                const markerTitle =
                  target === '$skip'
                    ? 'Not imported'
                    : conf >= 0.9
                      ? 'Matched'
                      : conf > 0
                        ? 'Guess — please confirm'
                        : 'Mapped by hand';
                return (
                  <tr key={column.name} className="border-t">
                    <td className="py-1.5 pr-3 font-medium">{column.name}</td>
                    <td className="max-w-48 truncate py-1.5 pr-3 text-[var(--color-ink-muted)]">
                      {column.samples.join(', ')}
                    </td>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <select
                          aria-label={`Field for ${column.name}`}
                          className="rounded border bg-[var(--color-surface)] px-2 py-1 text-sm"
                          value={target}
                          onChange={(e) => {
                            setMapping((m) => ({ ...m, [column.name]: e.target.value }));
                            setConfidence((c) => ({ ...c, [column.name]: e.target.value === '$skip' ? 0 : 1 }));
                          }}
                        >
                          <option value="$skip">Skip</option>
                          <option value="title">Title</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden title={markerTitle}>{marker}</span>
                        <span className="sr-only">{markerTitle}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="text-xs text-[var(--color-ink-muted)]">
              Match existing items by
              <select
                className="mt-1 block rounded border bg-[var(--color-surface)] px-2 py-1 text-sm"
                value={matchKey}
                onChange={(e) => setMatchKey(e.target.value)}
              >
                <option value="">Always create new items</option>
                <option value="title">Title</option>
                {fields
                  .filter((f) => Object.values(mapping).includes(f.key))
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-[var(--color-ink-muted)]">
              Save mapping as profile (optional)
              <input
                className="mt-1 block w-56 rounded border bg-[var(--color-surface)] px-2 py-1 text-sm"
                placeholder="Monthly client projects"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ml-auto rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void validate()}
            >
              {busy ? 'Checking…' : 'Run the dry run'}
            </button>
          </div>
        </section>
      )}

      {step === 'check' && job?.report && (
        <section aria-label="Dry-run report">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={job.report.rowCount} />
            <Stat label="Will create" value={job.willCreate} />
            <Stat label="Will update" value={job.willUpdate} />
            <Stat label="Cells that need attention" value={job.errorCount} tone={job.errorCount > 0 ? 'warn' : undefined} />
          </div>

          {job.report.columns.filter((c) => c.fieldKey && (c.invalid > 0 || c.coerced > 0)).map((c) => (
            <p key={c.header} className="mb-1 text-xs text-[var(--color-ink-muted)]">
              <span className="font-medium text-[var(--color-ink)]">{c.header}</span>
              {c.invalid > 0 && ` · ${c.invalid} value${c.invalid === 1 ? '' : 's'} could not be read — they will be kept as “needs attention” on their items, the rest of each row still imports`}
              {c.coerced > 0 && ` · ${c.coerced} value${c.coerced === 1 ? '' : 's'} will be tidied up during import`}
            </p>
          ))}

          {job.errorFileUrl && (
            <p className="mb-3 text-xs">
              <a className="underline underline-offset-2" href={job.errorFileUrl}>
                Download the per-row error CSV
              </a>
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="rounded px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]"
              disabled={busy}
              onClick={() => setStep('map')}
            >
              Back to mapping
            </button>
            <button
              type="button"
              className="ml-auto rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => void commit()}
            >
              {busy
                ? 'Importing…'
                : `Import ${job.willCreate.toLocaleString()} new${job.willUpdate > 0 ? `, update ${job.willUpdate.toLocaleString()}` : ''}`}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && job && (
        <section aria-label="Import complete">
          <p className="text-sm">
            Imported <span className="font-semibold">{job.fileName}</span> —{' '}
            {job.appliedCount?.toLocaleString()} item{job.appliedCount === 1 ? '' : 's'} written as
            one change set.
          </p>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Something look wrong? One undo reverts the whole import.
          </p>
          <div className="mt-4 flex gap-2">
            {job.changeSetId && (
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-sm hover:bg-[var(--color-muted)]"
                disabled={busy}
                onClick={() => void undo()}
              >
                Undo this import
              </button>
            )}
            <button
              type="button"
              className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white"
              onClick={() => {
                setJob(null);
                setStep('upload');
                setError(null);
                setProfileName('');
              }}
            >
              Import another file
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div className="rounded border p-3">
      <p className={`text-lg font-semibold tabular-nums ${tone === 'warn' && value > 0 ? 'text-[var(--color-warning)]' : ''}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-[var(--color-ink-muted)]">{label}</p>
    </div>
  );
}
