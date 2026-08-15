'use client';

/**
 * Guided variant generation (Step 10): pick axis values → preview the N
 * variants the server would create → create them, as one change set. The
 * preview is the server's change-set preview, not a client-side guess — the
 * count already excludes combinations that exist and has passed the 200-cap.
 */

import { useMemo, useState } from 'react';
import type { Field } from '@/server/db/schema/itemTypes';
import { api, ApiError } from '@/lib/api';
import type { SelectOption } from '@/types/fields';

interface GenerateVariantsDialogProps {
  itemId: string;
  modelTitle: string;
  /** The type's declared axes, in order — always `select` fields. */
  axisFields: Field[];
  existingCount: number;
  onCreated: (created: number) => void;
  onClose: () => void;
}

interface PreviewState {
  changeSetId: string;
  adding: number;
  skippedExisting: number;
  sampleTitles: string[];
}

export function GenerateVariantsDialog(props: GenerateVariantsDialogProps) {
  const [selected, setSelected] = useState<Map<string, Set<string>>>(
    () => new Map(props.axisFields.map((f) => [f.key, new Set<string>()])),
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optionsByAxis = useMemo(
    () =>
      new Map(
        props.axisFields.map((f) => [
          f.key,
          (((f.config ?? {}) as { options?: SelectOption[] }).options ?? []).filter(
            (o) => !o.archived,
          ),
        ]),
      ),
    [props.axisFields],
  );

  const combinationCount = props.axisFields.reduce(
    (n, f) => n * (selected.get(f.key)?.size ?? 0),
    1,
  );
  const ready = props.axisFields.every((f) => (selected.get(f.key)?.size ?? 0) > 0);

  const toggle = (axisKey: string, optionId: string) => {
    setPreview(null);
    setError(null);
    setSelected((current) => {
      const next = new Map(current);
      const set = new Set(next.get(axisKey));
      if (set.has(optionId)) set.delete(optionId);
      else set.add(optionId);
      next.set(axisKey, set);
      return next;
    });
  };

  const axisValues = () =>
    Object.fromEntries([...selected.entries()].map(([key, set]) => [key, [...set]]));

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.items.generateVariants(props.itemId, {
        axisValues: axisValues(),
        preview: true,
      });
      setPreview({
        changeSetId: result.id,
        adding: result.generation.adding,
        skippedExisting: result.generation.skippedExisting,
        sampleTitles: result.samples
          .filter((s) => s.before === null)
          .map((s) => s.title)
          .slice(0, 8),
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The preview failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const runCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.items.generateVariants(props.itemId, {
        axisValues: axisValues(),
        preview: false,
      });
      props.onCreated(result.generation.adding);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Creating the variants failed.');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label={`Generate variants of ${props.modelTitle}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-5 shadow-lg">
        <h3 className="text-sm font-semibold">Generate variants</h3>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          One variant is created for every combination of the values you pick. Shared fields stay
          on “{props.modelTitle}” and flow to all of them.
        </p>

        {props.axisFields.map((field) => (
          <fieldset key={field.key} className="mt-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {field.label}
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(optionsByAxis.get(field.key) ?? []).map((option) => {
                const on = selected.get(field.key)?.has(option.id) ?? false;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      on
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : 'hover:bg-[var(--color-muted)]'
                    }`}
                    onClick={() => toggle(field.key, option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
              {(optionsByAxis.get(field.key) ?? []).length === 0 && (
                <p className="text-xs text-[var(--color-ink-subtle)]">
                  This axis field has no options yet — add some in the type builder first.
                </p>
              )}
            </div>
          </fieldset>
        ))}

        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {preview && (
          <div className="mt-3 rounded border bg-[var(--color-muted)] p-3 text-xs">
            <p className="font-medium">
              {preview.adding} variant{preview.adding === 1 ? '' : 's'} will be created
              {preview.skippedExisting > 0 &&
                ` · ${preview.skippedExisting} already exist${preview.skippedExisting === 1 ? 's' : ''} and will be skipped`}
              .
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[var(--color-ink-muted)]">
              {preview.sampleTitles.map((title) => (
                <li key={title} className="truncate">
                  {title}
                </li>
              ))}
              {preview.adding > preview.sampleTitles.length && (
                <li>… and {preview.adding - preview.sampleTitles.length} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {preview === null ? (
            <button
              type="button"
              className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={!ready || busy}
              onClick={() => void runPreview()}
            >
              {busy
                ? 'Previewing…'
                : ready
                  ? `Preview ${combinationCount} variant${combinationCount === 1 ? '' : 's'}`
                  : 'Pick a value on every axis'}
            </button>
          ) : (
            <button
              type="button"
              className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy || preview.adding === 0}
              onClick={() => void runCreate()}
            >
              {busy ? 'Creating…' : `Create ${preview.adding} variant${preview.adding === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
