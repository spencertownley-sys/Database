"use client";

import { useState, useTransition } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { addDayLabel, removeDayLabel } from "@/app/actions/bands";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BandDayLabel } from "@/types";
import { useToast } from "@/components/ui/use-toast";

export function DayLabelsEditor({
  bandId,
  minDate,
  maxDate,
  dayLabels,
}: {
  bandId: string;
  minDate: string;
  maxDate: string;
  dayLabels: BandDayLabel[];
}) {
  const { toast } = useToast();
  const [labels, setLabels] = useState(dayLabels);
  const [selected, setSelected] = useState<Date[]>([]);
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    if (selected.length === 0 || !label.trim()) return;
    const dates = selected.map((d) => format(d, "yyyy-MM-dd"));
    startTransition(async () => {
      const result = await addDayLabel(bandId, dates, label);
      if (!result.ok) {
        toast({ title: "Couldn't save that label", description: result.error, variant: "destructive" });
        return;
      }
      setLabels((prev) => {
        const withoutDates = prev.filter((l) => !dates.includes(l.date));
        return [
          ...withoutDates,
          ...dates.map((date) => ({
            id: `${date}-local`,
            bandId,
            date,
            label: label.trim(),
            createdAt: new Date(),
          })),
        ].sort((a, b) => a.date.localeCompare(b.date));
      });
      setSelected([]);
      setLabel("");
      setOpen(false);
    });
  }

  function handleRemove(date: string) {
    startTransition(async () => {
      const result = await removeDayLabel(bandId, date);
      if (!result.ok) {
        toast({ title: "Couldn't remove that", description: result.error, variant: "destructive" });
        return;
      }
      setLabels((prev) => prev.filter((l) => l.date !== date));
    });
  }

  return (
    <div className="space-y-4">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            + Label specific dates
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto space-y-3 p-3" align="start">
          <Calendar
            mode="multiple"
            selected={selected}
            onSelect={(dates) => setSelected(dates ?? [])}
            fromDate={parseISO(minDate)}
            toDate={parseISO(maxDate)}
            className="rounded-md border"
          />
          <Input
            placeholder="Label — e.g. Load-in, Soundcheck"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
          />
          <Button
            className="w-full"
            size="sm"
            disabled={selected.length === 0 || !label.trim() || pending}
            onClick={handleAdd}
          >
            {pending ? "Saving…" : `Label ${selected.length || ""} date${selected.length === 1 ? "" : "s"}`}
          </Button>
        </PopoverContent>
      </Popover>

      {labels.length > 0 && (
        <ul className="space-y-1.5">
          {[...labels]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{format(parseISO(l.date), "EEE, MMM d")}</span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                    {l.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(l.date)}
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
