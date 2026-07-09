import Link from "next/link";
import { AlertCircle, TagIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatPercent } from "@/lib/utils";
import type { VoyageCatalogRow } from "./VoyageCatalog";

export function VoyageCard({ row }: { row: VoyageCatalogRow }) {
  const occ = Number(row.voyage.occupancyPercent ?? 0);
  return (
    <Link href={`/voyages/${row.voyage.id}`}>
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {row.voyage.voyageCode}
            </span>
            <Badge variant="outline" className="text-[10px] capitalize">
              {row.voyage.status}
            </Badge>
          </div>
          <div>
            <p className="line-clamp-2 text-sm font-medium">
              {row.voyage.itineraryName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {row.shipName} · {row.regionName ?? "Unassigned"}
            </p>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>
              {formatDate(row.voyage.sailDate)} · {row.voyage.durationNights}n
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatPercent(occ)} booked
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${occ >= 80 ? "bg-emerald-500" : occ >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
              style={{ width: `${Math.min(100, occ)}%` }}
            />
          </div>
          <div className="pt-1">
            {row.activePromoCount === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                No active promo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {row.activePromoCount} active promo{row.activePromoCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
