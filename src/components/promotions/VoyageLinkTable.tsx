"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectFilter, DateFilter, FilterBar } from "@/components/shared/FilterBar";
import { useToast } from "@/components/ui/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import {
  linkVoyages,
  unlinkVoyages,
  setVoyageOverride,
} from "@/app/actions/promotions";
import { formatDate, formatPercent } from "@/lib/utils";
import type { Voyage } from "@/types";

interface LinkedVoyageRow {
  linkId: string;
  voyageId: string;
  overrideOfferValue: string | null;
  voyageCode: string;
  itineraryName: string;
  sailDate: string;
  durationNights: number;
  shipName: string;
  regionName: string;
  occupancyPercent: string | null;
}

interface AvailableVoyageRow {
  voyage: Voyage;
  shipName: string;
  regionName: string | null;
  activePromoCount: number;
}

interface VoyageLinkTableProps {
  promoId: string;
  defaultOfferValue: string;
  initialLinked: LinkedVoyageRow[];
  ships: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  canEdit: boolean;
}

const DURATIONS = [3, 4, 5, 6, 7, 8, 10, 12, 14];

export function VoyageLinkTable({
  promoId,
  defaultOfferValue,
  initialLinked,
  ships,
  regions,
  canEdit,
}: VoyageLinkTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  // Left panel filters
  const [shipId, setShipId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [duration, setDuration] = useState("");
  const [maxOccupancy, setMaxOccupancy] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 300);

  const [available, setAvailable] = useState<AvailableVoyageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAvailable, setSelectedAvailable] = useState<Set<string>>(new Set());
  const [selectedLinked, setSelectedLinked] = useState<Set<string>>(new Set());
  const [overrideTarget, setOverrideTarget] = useState<LinkedVoyageRow | null>(null);
  const [overrideValue, setOverrideValue] = useState("");

  const linkedIds = useMemo(
    () => new Set(initialLinked.map((l) => l.voyageId)),
    [initialLinked]
  );

  const fetchAvailable = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (shipId) params.set("shipId", shipId);
    if (regionId) params.set("regionId", regionId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (duration) params.set("duration", duration);
    if (maxOccupancy) params.set("maxOccupancy", maxOccupancy);
    if (debouncedQ) params.set("q", debouncedQ);
    params.set("limit", "800");
    fetch(`/api/voyages?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AvailableVoyageRow[]) => setAvailable(rows))
      .catch(() => setAvailable([]))
      .finally(() => setLoading(false));
  }, [shipId, regionId, from, to, duration, maxOccupancy, debouncedQ]);

  useEffect(() => {
    fetchAvailable();
  }, [fetchAvailable]);

  const unlinkied = useMemo(
    () => available.filter((r) => !linkedIds.has(r.voyage.id)),
    [available, linkedIds]
  );

  function addSelected(ids: string[]) {
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await linkVoyages(promoId, ids);
      if (result.ok) {
        toast({
          title: "Voyages linked",
          description: `${result.data?.linked ?? 0} voyage(s) added to this promotion.`,
        });
        setSelectedAvailable(new Set());
        router.refresh();
      } else {
        toast({ title: "Link failed", description: result.error, variant: "destructive" });
      }
    });
  }

  function removeSelected(ids: string[]) {
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await unlinkVoyages(promoId, ids);
      if (result.ok) {
        toast({
          title: "Voyages removed",
          description: `${result.data?.removed ?? 0} voyage(s) unlinked.`,
        });
        setSelectedLinked(new Set());
        router.refresh();
      } else {
        toast({ title: "Remove failed", description: result.error, variant: "destructive" });
      }
    });
  }

  function saveOverride() {
    if (!overrideTarget) return;
    startTransition(async () => {
      const result = await setVoyageOverride(
        promoId,
        overrideTarget.voyageId,
        overrideValue.trim() || null
      );
      setOverrideTarget(null);
      if (result.ok) {
        router.refresh();
      } else {
        toast({ title: "Override failed", description: result.error, variant: "destructive" });
      }
    });
  }

  const hasFilters = !!(shipId || regionId || from || to || duration || maxOccupancy || q);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* Left: available voyages */}
      <Card className="min-w-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">Available voyages</CardTitle>
          <CardDescription>
            Filter, select, and bulk-add sailings to this promotion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FilterBar
            hasFilters={hasFilters}
            onClear={() => {
              setShipId(""); setRegionId(""); setFrom(""); setTo("");
              setDuration(""); setMaxOccupancy(""); setQ("");
            }}
          >
            <Input
              placeholder="Search code or itinerary…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-44 text-xs"
            />
            <SelectFilter
              placeholder="All ships"
              value={shipId}
              onChange={setShipId}
              options={ships.map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectFilter
              placeholder="All regions"
              value={regionId}
              onChange={setRegionId}
              options={regions.map((r) => ({ value: r.id, label: r.name }))}
            />
            <SelectFilter
              placeholder="Any duration"
              value={duration}
              onChange={setDuration}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d} nights` }))}
            />
            <SelectFilter
              placeholder="Any occupancy"
              value={maxOccupancy}
              onChange={setMaxOccupancy}
              options={[
                { value: "40", label: "< 40% booked" },
                { value: "60", label: "< 60% booked" },
                { value: "80", label: "< 80% booked" },
              ]}
            />
            <DateFilter label="Sailing" value={from} onChange={setFrom} />
            <DateFilter label="to" value={to} onChange={setTo} />
          </FilterBar>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={isPending || selectedAvailable.size === 0}
                onClick={() => addSelected(Array.from(selectedAvailable))}
              >
                <Plus className="h-4 w-4" />
                Add selected ({selectedAvailable.size})
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending || unlinkied.length === 0}
                onClick={() => addSelected(unlinkied.map((r) => r.voyage.id))}
              >
                Add all {unlinkied.length} matching
              </Button>
            </div>
          )}

          <div className="max-h-[520px] overflow-y-auto rounded-md border">
            {loading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : unlinkied.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No unlinked voyages match these filters.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="w-8 px-2 py-2">
                      <Checkbox
                        checked={
                          selectedAvailable.size > 0 &&
                          selectedAvailable.size === unlinkied.length
                        }
                        onCheckedChange={(c) =>
                          setSelectedAvailable(
                            c ? new Set(unlinkied.map((r) => r.voyage.id)) : new Set()
                          )
                        }
                      />
                    </th>
                    <th className="px-2 py-2">Voyage</th>
                    <th className="px-2 py-2">Sails</th>
                    <th className="px-2 py-2">Occ.</th>
                    <th className="px-2 py-2">Promos</th>
                  </tr>
                </thead>
                <tbody>
                  {unlinkied.map((r) => (
                    <tr key={r.voyage.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-1.5">
                        <Checkbox
                          checked={selectedAvailable.has(r.voyage.id)}
                          onCheckedChange={(c) => {
                            const next = new Set(selectedAvailable);
                            if (c) next.add(r.voyage.id);
                            else next.delete(r.voyage.id);
                            setSelectedAvailable(next);
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{r.voyage.voyageCode}</span>
                          <span className="max-w-[240px] truncate text-xs text-muted-foreground">
                            {r.shipName} · {r.voyage.itineraryName}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {formatDate(r.voyage.sailDate)}
                      </td>
                      <td className="px-2 py-1.5 text-xs tabular-nums">
                        {formatPercent(r.voyage.occupancyPercent)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1 text-xs tabular-nums">
                          {r.activePromoCount}
                          {r.activePromoCount >= 5 && (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                This voyage already has {r.activePromoCount} active promos
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Right: linked voyages */}
      <Card className="min-w-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px]">
            Linked voyages
            <Badge variant="secondary">{initialLinked.length}</Badge>
          </CardTitle>
          <CardDescription>
            Default offer: {defaultOfferValue}. Override per voyage where needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && initialLinked.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={isPending || selectedLinked.size === 0}
              onClick={() => removeSelected(Array.from(selectedLinked))}
            >
              <Trash2 className="h-4 w-4" />
              Remove selected ({selectedLinked.size})
            </Button>
          )}

          <div className="max-h-[560px] overflow-y-auto rounded-md border">
            {initialLinked.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No voyages linked yet. Add sailings from the left panel.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    {canEdit && (
                      <th className="w-8 px-2 py-2">
                        <Checkbox
                          checked={
                            selectedLinked.size > 0 &&
                            selectedLinked.size === initialLinked.length
                          }
                          onCheckedChange={(c) =>
                            setSelectedLinked(
                              c
                                ? new Set(initialLinked.map((l) => l.voyageId))
                                : new Set()
                            )
                          }
                        />
                      </th>
                    )}
                    <th className="px-2 py-2">Voyage</th>
                    <th className="px-2 py-2">Sails</th>
                    <th className="px-2 py-2">Offer</th>
                    {canEdit && <th className="w-10 px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {initialLinked.map((l) => (
                    <tr key={l.linkId} className="border-b last:border-0 hover:bg-muted/50">
                      {canEdit && (
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={selectedLinked.has(l.voyageId)}
                            onCheckedChange={(c) => {
                              const next = new Set(selectedLinked);
                              if (c) next.add(l.voyageId);
                              else next.delete(l.voyageId);
                              setSelectedLinked(next);
                            }}
                          />
                        </td>
                      )}
                      <td className="px-2 py-1.5">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{l.voyageCode}</span>
                          <span className="max-w-[240px] truncate text-xs text-muted-foreground">
                            {l.shipName} · {l.itineraryName}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                        {formatDate(l.sailDate)}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {l.overrideOfferValue ? (
                          <Badge variant="outline" className="font-normal">
                            {l.overrideOfferValue}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">default</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-2 py-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setOverrideTarget(l);
                              setOverrideValue(l.overrideOfferValue ?? "");
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Override dialog */}
      <Dialog open={!!overrideTarget} onOpenChange={(o) => !o && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voyage offer override</DialogTitle>
            <DialogDescription>
              {overrideTarget?.voyageCode}: leave blank to use the promo default
              ({defaultOfferValue}).
            </DialogDescription>
          </DialogHeader>
          <Input
            value={overrideValue}
            onChange={(e) => setOverrideValue(e.target.value)}
            placeholder={defaultOfferValue}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={isPending}>
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
