'use client';

/**
 * The completeness bar + %, shared by grid rows, list rows, board cards, and
 * the detail panel so the number always looks like the same number.
 *
 * The ramp is UI/UX §2, four defined stops: Rose 0–33 → Amber 34–66 →
 * Emerald 67–99 → solid Emerald-600 at 100. Never color alone — the % is
 * always present (accessibility §8).
 */

export function completenessColor(pct: number): string {
  if (pct >= 100) return 'var(--color-completeness-done)';
  if (pct >= 67) return 'var(--color-success)';
  if (pct >= 34) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

export function CompletenessBar({ pct, compact = false }: { pct: number; compact?: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5"
      role="img"
      aria-label={`${pct}% complete`}
      title={`${pct}% complete`}
    >
      <span
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]"
        style={{ minWidth: compact ? 28 : 48 }}
        aria-hidden
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: completenessColor(pct) }}
        />
      </span>
      <span className="tabular w-8 shrink-0 text-right text-xs text-[var(--color-ink-muted)]">
        {pct}%
      </span>
    </span>
  );
}
