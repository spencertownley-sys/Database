"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AVAILABILITY_STATUSES, STATUS_META, type AvailabilityStatus } from "@/lib/constants";
import type { AvailabilityException } from "@/types";
import { cn } from "@/lib/utils";

export function ExceptionsEditor({
  exceptions,
  onSave,
  onRemove,
}: {
  exceptions: AvailabilityException[];
  onSave: (date: string, status: AvailabilityStatus, note?: string) => Promise<unknown>;
  onRemove: (date: string) => Promise<unknown>;
}) {
  const [date, setDate] = useState<Date | undefined>();
  const [status, setStatus] = useState<AvailabilityStatus>("unavailable");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    if (!date) return;
    const dateStr = format(date, "yyyy-MM-dd");
    startTransition(async () => {
      await onSave(dateStr, status, note);
      setDate(undefined);
      setNote("");
      setStatus("unavailable");
      setOpen(false);
    });
  }

  return (
    <div className="space-y-4">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            + Add a specific date
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto space-y-3 p-3" align="start">
          <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-md border" />
          <div className="flex gap-1.5">
            {AVAILABILITY_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  status === s ? STATUS_META[s].cellClass : "hover:bg-muted"
                )}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Note (optional) — e.g. out of town"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={100}
          />
          <Button className="w-full" size="sm" disabled={!date || pending} onClick={handleSave}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </PopoverContent>
      </Popover>

      {exceptions.length > 0 && (
        <ul className="space-y-1.5">
          {exceptions.map((ex) => (
            <li
              key={ex.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[ex.status as AvailabilityStatus].dotClass)} />
                <span className="font-medium">
                  {format(new Date(`${ex.date}T00:00:00`), "EEE, MMM d")}
                </span>
                <span className="text-muted-foreground">
                  {STATUS_META[ex.status as AvailabilityStatus].label}
                  {ex.note ? ` — ${ex.note}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => startTransition(() => { onRemove(ex.date); })}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
