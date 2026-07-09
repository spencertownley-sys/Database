import {
  CircleDot,
  Pencil,
  Link2,
  CheckCircle2,
  ArrowRightCircle,
  Trash2,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { ActivityLogEntry, ActivityChanges } from "@/types";

const ACTION_META: Record<string, { label: string; icon: typeof CircleDot }> = {
  created: { label: "created", icon: CircleDot },
  updated: { label: "updated", icon: Pencil },
  voyages_linked: { label: "linked voyages to", icon: Link2 },
  voyages_unlinked: { label: "removed voyages from", icon: Link2 },
  voyage_override_set: { label: "set a voyage override on", icon: Link2 },
  disclaimers_updated: { label: "updated disclaimers on", icon: Pencil },
  audiences_updated: { label: "updated audiences on", icon: Pencil },
  status_changed: { label: "changed status of", icon: ArrowRightCircle },
  approved: { label: "approved", icon: CheckCircle2 },
  deleted: { label: "deleted", icon: Trash2 },
};

function describeChanges(changes: ActivityChanges | null): string | null {
  if (!changes) return null;
  const parts: string[] = [];
  for (const [field, { old, new: next }] of Object.entries(changes)) {
    if (field === "status") {
      parts.push(`${old ?? "—"} → ${next}`);
    } else if (typeof next === "number" || typeof next === "string") {
      parts.push(`${field.replace(/_/g, " ")}: ${String(next).slice(0, 60)}`);
    } else {
      parts.push(field.replace(/_/g, " "));
    }
  }
  return parts.slice(0, 3).join(" · ") || null;
}

export function PromoTimeline({
  entries,
  entityLabel = "this promotion",
}: {
  entries: { entry: ActivityLogEntry; performerName: string | null }[];
  entityLabel?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l pl-5">
      {entries.map(({ entry, performerName }) => {
        const meta = ACTION_META[entry.action] ?? {
          label: entry.action.replace(/_/g, " "),
          icon: CircleDot,
        };
        const Icon = meta.icon;
        const detail = describeChanges(entry.changes as ActivityChanges | null);
        return (
          <li key={entry.id} className="relative">
            <span className="absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full bg-background">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="text-sm">
              <span className="font-medium">{performerName ?? "System"}</span>{" "}
              <span className="text-muted-foreground">
                {meta.label} {entityLabel}
              </span>
            </div>
            {detail && (
              <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
            )}
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
              {formatDateTime(entry.performedAt)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
