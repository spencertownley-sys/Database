import Link from "next/link";
import { formatDateTime } from "@/lib/utils";
import type { ActivityLogEntry, ActivityChanges } from "@/types";

interface RecentActivityProps {
  entries: {
    entry: ActivityLogEntry;
    performerName: string | null;
    entityName?: string | null;
  }[];
}

const ACTION_LABELS: Record<string, string> = {
  created: "created",
  updated: "updated",
  status_changed: "changed status of",
  voyages_linked: "linked voyages to",
  voyages_unlinked: "removed voyages from",
  voyage_override_set: "set an override on",
  disclaimers_updated: "updated disclaimers on",
  audiences_updated: "updated audiences on",
  approved: "approved",
  deleted: "deleted",
  role_changed: "changed a role on",
};

export function RecentActivity({ entries }: RecentActivityProps) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {entries.map(({ entry, performerName, entityName }) => {
        const changes = entry.changes as ActivityChanges | null;
        const statusChange = changes?.status
          ? `${changes.status.old ?? "—"} → ${changes.status.new}`
          : null;
        const label = entityName ?? `${entry.entityType.replace(/_/g, " ")}`;
        return (
          <li key={entry.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
            <div className="min-w-0 flex-1">
              <p className="leading-snug">
                <span className="font-medium">{performerName ?? "System"}</span>{" "}
                <span className="text-muted-foreground">
                  {ACTION_LABELS[entry.action] ?? entry.action.replace(/_/g, " ")}
                </span>{" "}
                {entry.entityType === "promotion" ? (
                  <Link
                    href={`/promotions/${entry.entityId}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {label}
                  </Link>
                ) : (
                  <span className="font-medium">{label}</span>
                )}
                {statusChange && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({statusChange})
                  </span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                {formatDateTime(entry.performedAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
