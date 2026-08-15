'use client';

/**
 * A one-time teaching card (UI/UX §7). Dismissal is remembered per user per
 * hint in localStorage — the concept stays invisible after the person says
 * they've got it, which is the §6 invisibility rule in card form.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const HINTS = {
  variants: {
    title: 'Variants let one item have versions that share most of their data.',
    body: 'Fields marked shared live on the model — change the tagline once and every region updates. Fields marked per-variant inherit until a variant overrides them, and one click reverts to inherited.',
  },
  trees: {
    title: 'Category trees organize items without moving them.',
    body: 'The work hierarchy says what belongs to what; trees say how you file things. One deliverable can sit in “Acme” and in “Design” at the same time, without being duplicated.',
  },
  completeness: {
    title: 'Completeness counts the required fields that are filled in.',
    body: 'Pick which fields count on the item type, and every item shows how done its data is. Filter any view to “incomplete only” to see what needs attention.',
  },
} as const;

export type ConceptHintKey = keyof typeof HINTS;

export function ConceptHint({ hint }: { hint: ConceptHintKey }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(`strata-hint-${hint}`) !== 'dismissed');
    } catch {
      setVisible(true);
    }
  }, [hint]);

  if (!visible) return null;
  const copy = HINTS[hint];

  return (
    <aside
      aria-label={copy.title}
      className="mb-3 flex items-start gap-3 rounded-[var(--radius-lg)] border border-l-2 border-l-[var(--color-accent)] bg-[var(--color-surface)] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{copy.body}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss this explanation"
        className="shrink-0 rounded p-1 text-[var(--color-ink-subtle)] hover:bg-[var(--color-muted)]"
        onClick={() => {
          try {
            localStorage.setItem(`strata-hint-${hint}`, 'dismissed');
          } catch {
            /* private mode — the card just reappears next visit */
          }
          setVisible(false);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </aside>
  );
}
