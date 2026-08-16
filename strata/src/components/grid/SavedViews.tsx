'use client';

/**
 * Saved-view picker + save/share controls for the view toolbar.
 *
 * Sharing renders the 🔒 warning verbatim: hiding fields in a shared view is
 * presentation, not security (PRD §9 Risk 3, UI/UX §3.10) — the person about
 * to paste a link into an email is the one who needs to read that sentence.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ViewConfigWire, type ViewWire } from '@/lib/api';

interface SavedViewsProps {
  itemTypeId: string;
  /** The toolbar's live state, captured at save time. */
  currentConfig: () => ViewConfigWire;
  currentType: 'grid' | 'list' | 'board';
  onApply: (view: ViewWire) => void;
}

export function SavedViews(props: SavedViewsProps) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState('');
  const [dialog, setDialog] = useState<'save' | 'share' | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const queryKey = ['views', props.itemTypeId];
  const { data } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.views.list(props.itemTypeId, signal),
  });
  const viewList = data?.data ?? [];
  const active = viewList.find((v) => v.id === activeId) ?? null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.views.create({
        itemTypeId: props.itemTypeId,
        name: name.trim(),
        type: props.currentType,
        visibility,
        config: props.currentConfig(),
      });
      refresh();
      setActiveId(created.id);
      setDialog(null);
      setName('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Saving the view failed.');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.views.update(active.id, { visibility: 'shared' });
      refresh();
      setShareUrl(updated.shareUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sharing failed.');
    } finally {
      setBusy(false);
    }
  };

  const unshare = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.views.update(active.id, { visibility: 'workspace' });
      refresh();
      setShareUrl(null);
      setDialog(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Revoking the link failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <select
        aria-label="Saved views"
        className="rounded border bg-[var(--color-surface)] px-1.5 py-1 text-xs"
        value={activeId}
        onChange={(e) => {
          setActiveId(e.target.value);
          const view = viewList.find((v) => v.id === e.target.value);
          if (view) props.onApply(view);
        }}
      >
        <option value="">Unsaved view</option>
        {viewList.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
            {view.visibility === 'shared' ? ' (shared)' : view.visibility === 'private' ? ' (private)' : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded border px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
        onClick={() => {
          setDialog('save');
          setError(null);
        }}
      >
        Save view
      </button>
      {active && (
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
          onClick={() => {
            setDialog('share');
            setShareUrl(active.shareUrl);
            setError(null);
          }}
        >
          Share…
        </button>
      )}

      {dialog === 'save' && (
        <div role="dialog" aria-label="Save view" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Save this view</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Filters, sort, search, and layout are saved exactly as they are now.
            </p>
            <input
              autoFocus
              className="mt-3 w-full rounded border bg-[var(--color-surface)] px-2 py-1.5 text-sm"
              placeholder="View name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) void save();
              }}
            />
            <label className="mt-3 block text-xs text-[var(--color-ink-muted)]">
              Who can see it
              <select
                className="mt-1 block w-full rounded border bg-[var(--color-surface)] px-2 py-1.5 text-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'private' | 'workspace')}
              >
                <option value="private">Only me</option>
                <option value="workspace">Everyone in the workspace</option>
              </select>
            </label>
            {error && <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={busy || !name.trim()}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === 'share' && active && (
        <div role="dialog" aria-label={`Share ${active.name}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Share “{active.name}” outside the workspace</h3>
            <p className="mt-2 rounded border-l-2 border-l-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs">
              <span className="font-semibold">Anyone with the link can see this view’s items.</span>{' '}
              Hiding fields controls what the page shows — it is presentation, not security. Don’t
              share views over data you wouldn’t email to an outsider.
            </p>
            {shareUrl ? (
              <>
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">The live link:</p>
                <code className="mt-1 block truncate rounded bg-[var(--color-muted)] px-2 py-1.5 text-xs">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                  {shareUrl}
                </code>
                <div className="mt-4 flex justify-between gap-2">
                  <button type="button" className="rounded border px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]" disabled={busy} onClick={() => void unshare()}>
                    Revoke the link
                  </button>
                  <button type="button" className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white" onClick={() => setDialog(null)}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="rounded px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void share()}
                >
                  {busy ? 'Creating link…' : 'Create the public link'}
                </button>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
