"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { setAvailabilityBulk, type AvailabilityUpdate } from "@/app/actions/availability";
import { AVAILABILITY_STATUSES, STATUS_META, UNFILLED_META, formatTimeSlot } from "@/lib/constants";
import type { AvailabilityStatus, DateColumn, MemberGrid } from "@/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface CellPos {
  r: number;
  c: number;
}

export function DateAvailabilityGrid({
  slug,
  token,
  dateColumns,
  timeSlots,
  initialGrid,
}: {
  slug: string;
  token: string;
  dateColumns: DateColumn[];
  timeSlots: string[];
  initialGrid: MemberGrid;
}) {
  const { toast } = useToast();
  const [savedGrid, setSavedGrid] = useState<MemberGrid>(initialGrid);
  const [localGrid, setLocalGrid] = useState<MemberGrid>(initialGrid);
  const [activeStatus, setActiveStatus] = useState<AvailabilityStatus>("available");
  const [saving, setSaving] = useState(false);

  const [dragStart, setDragStart] = useState<CellPos | null>(null);
  const [dragEnd, setDragEnd] = useState<CellPos | null>(null);
  const draggedRef = useRef(false);

  const dragStartRef = useRef<CellPos | null>(null);
  const dragEndRef = useRef<CellPos | null>(null);
  const activeStatusRef = useRef(activeStatus);
  useEffect(() => {
    activeStatusRef.current = activeStatus;
  }, [activeStatus]);
  useEffect(() => {
    dragStartRef.current = dragStart;
  }, [dragStart]);
  useEffect(() => {
    dragEndRef.current = dragEnd;
  }, [dragEnd]);

  function getStatus(grid: MemberGrid, date: string, slot: string): AvailabilityStatus | null {
    return grid[date]?.[slot] ?? null;
  }

  function setCells(cells: CellPos[], status: AvailabilityStatus) {
    setLocalGrid((prev) => {
      const next: MemberGrid = { ...prev };
      for (const { r, c } of cells) {
        const date = dateColumns[c].date;
        const slot = timeSlots[r];
        next[date] = { ...next[date], [slot]: status };
      }
      return next;
    });
  }

  function commitRectFill(start: CellPos, end: CellPos, status: AvailabilityStatus) {
    const rMin = Math.min(start.r, end.r);
    const rMax = Math.max(start.r, end.r);
    const cMin = Math.min(start.c, end.c);
    const cMax = Math.max(start.c, end.c);
    const cells: CellPos[] = [];
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        cells.push({ r, c });
      }
    }
    setCells(cells, status);
  }

  useEffect(() => {
    function handleMouseUp() {
      const start = dragStartRef.current;
      const end = dragEndRef.current;
      if (start && end && draggedRef.current) {
        commitRectFill(start, end, activeStatusRef.current);
      }
      setDragStart(null);
      setDragEnd(null);
      if (draggedRef.current) {
        // The browser fires a synthetic `click` on the cell right after
        // mouseup — delay clearing so that handler still sees a drag just
        // happened and skips its own single-cell toggle.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCellMouseDown(r: number, c: number) {
    setDragStart({ r, c });
    setDragEnd({ r, c });
  }

  function handleCellMouseEnter(r: number, c: number) {
    if (!dragStartRef.current) return;
    setDragEnd({ r, c });
    if (r !== dragStartRef.current.r || c !== dragStartRef.current.c) {
      draggedRef.current = true;
    }
  }

  function handleCellClick(r: number, c: number) {
    if (draggedRef.current) return; // a drag just finished on this cell
    setCells([{ r, c }], activeStatus);
  }

  function isInDragRect(r: number, c: number): boolean {
    if (!dragStart || !dragEnd) return false;
    const rMin = Math.min(dragStart.r, dragEnd.r);
    const rMax = Math.max(dragStart.r, dragEnd.r);
    const cMin = Math.min(dragStart.c, dragEnd.c);
    const cMax = Math.max(dragStart.c, dragEnd.c);
    return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
  }

  function fillAll() {
    const cells: CellPos[] = [];
    for (let r = 0; r < timeSlots.length; r++) {
      for (let c = 0; c < dateColumns.length; c++) cells.push({ r, c });
    }
    setCells(cells, activeStatus);
  }

  function fillRow(r: number) {
    const cells = dateColumns.map((_, c) => ({ r, c }));
    setCells(cells, activeStatus);
  }

  function fillColumn(c: number) {
    const cells = timeSlots.map((_, r) => ({ r, c }));
    setCells(cells, activeStatus);
  }

  function fillRemaining() {
    const cells: CellPos[] = [];
    for (let r = 0; r < timeSlots.length; r++) {
      for (let c = 0; c < dateColumns.length; c++) {
        if (!getStatus(localGrid, dateColumns[c].date, timeSlots[r])) {
          cells.push({ r, c });
        }
      }
    }
    setCells(cells, activeStatus);
  }

  function clearPendingChanges() {
    setLocalGrid(savedGrid);
  }

  const dirtyUpdates = useMemo<AvailabilityUpdate[]>(() => {
    const updates: AvailabilityUpdate[] = [];
    for (const col of dateColumns) {
      for (const slot of timeSlots) {
        const local = getStatus(localGrid, col.date, slot);
        const saved = getStatus(savedGrid, col.date, slot);
        if (local && local !== saved) {
          updates.push({ date: col.date, timeSlot: slot, status: local });
        }
      }
    }
    return updates;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localGrid, savedGrid]);

  async function handleSave() {
    if (dirtyUpdates.length === 0) return;
    setSaving(true);
    const result = await setAvailabilityBulk(slug, token, dirtyUpdates);
    setSaving(false);
    if (!result.ok) {
      toast({ title: "Couldn't save", description: result.error, variant: "destructive" });
      return;
    }
    setSavedGrid(localGrid);
    toast({ title: "Saved", description: "Your availability is up to date." });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {AVAILABILITY_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setActiveStatus(status)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              activeStatus === status
                ? cn(STATUS_META[status].cellClass, "border-transparent")
                : "hover:bg-muted"
            )}
          >
            {STATUS_META[status].label}
          </button>
        ))}
        <span className="ml-1 text-xs text-muted-foreground">is selected — click or drag cells</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={fillAll}>
          Fill all
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={fillRemaining}>
          Fill remaining
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={clearPendingChanges}>
          Clear unsaved changes
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {dirtyUpdates.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {dirtyUpdates.length} unsaved change{dirtyUpdates.length === 1 ? "" : "s"}
            </span>
          )}
          <Button type="button" size="sm" onClick={handleSave} disabled={saving || dirtyUpdates.length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <div
          className="grid select-none"
          style={{
            gridTemplateColumns: `120px repeat(${dateColumns.length}, minmax(64px, 1fr))`,
          }}
        >
          <div className="sticky left-0 z-10 border-b border-r bg-card" />
          {dateColumns.map((col, c) => (
            <button
              key={col.date}
              type="button"
              onClick={() => fillColumn(c)}
              title={`Fill ${format(parseISO(col.date), "EEE, MMM d")} with ${STATUS_META[activeStatus].label}`}
              className="flex flex-col items-center justify-center border-b border-l bg-card px-1 py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              <span>{format(parseISO(col.date), "EEE")}</span>
              <span>{format(parseISO(col.date), "M/d")}</span>
              {col.label && (
                <span className="mt-0.5 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                  {col.label}
                </span>
              )}
            </button>
          ))}

          {timeSlots.map((slot, r) => (
            <div key={slot} className="contents">
              <button
                type="button"
                onClick={() => fillRow(r)}
                title={`Fill ${formatTimeSlot(slot)} with ${STATUS_META[activeStatus].label}`}
                className="sticky left-0 z-10 flex items-center justify-end border-b border-r bg-card px-2 py-2 text-right text-[11px] font-medium text-muted-foreground hover:bg-muted"
              >
                {formatTimeSlot(slot)}
              </button>
              {dateColumns.map((col, c) => {
                const status = localGrid[col.date]?.[slot];
                const meta = status ? STATUS_META[status] : UNFILLED_META;
                const inRect = isInDragRect(r, c);
                return (
                  <button
                    key={`${col.date}-${slot}`}
                    type="button"
                    onMouseDown={() => handleCellMouseDown(r, c)}
                    onMouseEnter={() => handleCellMouseEnter(r, c)}
                    onClick={() => handleCellClick(r, c)}
                    title={`${format(parseISO(col.date), "EEE, MMM d")} ${formatTimeSlot(slot)}: ${meta.label}`}
                    className={cn(
                      "h-9 border-b border-l text-[10px] font-medium transition-colors",
                      meta.cellClass,
                      inRect && "ring-2 ring-inset ring-foreground/60"
                    )}
                  >
                    <span className="sr-only">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
