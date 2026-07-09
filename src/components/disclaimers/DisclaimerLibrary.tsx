"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DisclaimerEditor } from "@/components/disclaimers/DisclaimerEditor";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/constants";
import { formatDate, cn } from "@/lib/utils";
import type { Disclaimer } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  retired: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export interface DisclaimerRow {
  disclaimer: Disclaimer;
  usageCount: number;
}

interface DisclaimerLibraryProps {
  rows: DisclaimerRow[];
  canEdit: boolean;
  canApprove: boolean;
  highlightId?: string;
}

export function DisclaimerLibrary({
  rows,
  canEdit,
  canApprove,
  highlightId,
}: DisclaimerLibraryProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DisclaimerRow | null>(
    () => rows.find((r) => r.disclaimer.id === highlightId) ?? null
  );
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.disclaimer.name.toLowerCase().includes(q) ||
        r.disclaimer.disclaimerText.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // Group versions under one name
  const grouped = useMemo(() => {
    const map = new Map<string, DisclaimerRow[]>();
    for (const r of filtered) {
      const list = map.get(r.disclaimer.name) ?? [];
      list.push(r);
      map.set(r.disclaimer.name, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or text…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => { setCreating(true); setSelected(null); }}>
              New disclaimer
            </Button>
          )}
        </div>

        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No disclaimers match your search.
            </p>
          )}
          {grouped.map(([name, versions]) => (
            <Card key={name} className="overflow-hidden">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm">{name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-3 pt-1">
                {versions.map((r) => (
                  <button
                    key={r.disclaimer.id}
                    onClick={() => { setSelected(r); setCreating(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                      selected?.disclaimer.id === r.disclaimer.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-transparent hover:bg-accent"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("border-transparent text-[10px] capitalize", STATUS_STYLES[r.disclaimer.status])}
                      >
                        {r.disclaimer.status}
                      </Badge>
                      <span className="font-medium">v{r.disclaimer.version}</span>
                      <span className="text-muted-foreground">
                        {r.disclaimer.effectiveDate
                          ? `effective ${formatDate(r.disclaimer.effectiveDate)}`
                          : "no effective date"}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {r.usageCount} active promo{r.usageCount === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
                <div className="flex flex-wrap gap-1 pt-1">
                  {(versions[0].disclaimer.appliesToOfferTypes ?? []).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                      {OFFER_TYPE_LABELS[t as OfferType] ?? t}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="lg:col-span-3">
        <DisclaimerEditor
          key={creating ? "new" : selected?.disclaimer.id ?? "none"}
          row={creating ? null : selected}
          creating={creating}
          canEdit={canEdit}
          canApprove={canApprove}
          onDone={() => setCreating(false)}
        />
      </div>
    </div>
  );
}
