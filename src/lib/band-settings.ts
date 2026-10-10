import { addDays, format, parseISO } from "date-fns";
import { ALL_DAY_SLOT, DAYS_OF_WEEK, TIMEZONES, generateTimeSlots } from "@/lib/constants";
import type { Band, BandDayLabel } from "@/types";

export interface DateColumn {
  date: string; // "yyyy-MM-dd"
  label: string | null;
  dayOfWeek: number; // 0-6, Sunday-based
}

/** Expands band.startDate..band.endDate into one entry per active day of week. */
export function getDateColumns(
  band: Pick<Band, "startDate" | "endDate" | "activeDays">,
  dayLabels: Pick<BandDayLabel, "date" | "label">[] = []
): DateColumn[] {
  const labelByDate = new Map(dayLabels.map((l) => [l.date, l.label]));
  const activeDays = new Set(band.activeDays ?? [0, 1, 2, 3, 4, 5, 6]);

  const start = parseISO(band.startDate);
  const end = parseISO(band.endDate);
  const columns: DateColumn[] = [];

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dayOfWeek = d.getDay();
    if (!activeDays.has(dayOfWeek)) continue;
    const dateStr = format(d, "yyyy-MM-dd");
    columns.push({
      date: dateStr,
      dayOfWeek,
      label: labelByDate.get(dateStr) ?? null,
    });
  }

  return columns;
}

/** Time slots for a band's grid, or a single all-day sentinel slot. */
export function getTimeSlots(
  band: Pick<Band, "scheduleType" | "timeSlotStart" | "timeSlotEnd" | "timeSlotMinutes">
): string[] {
  if (band.scheduleType !== "date_time") return [ALL_DAY_SLOT];
  const slots = generateTimeSlots(band.timeSlotStart, band.timeSlotEnd, band.timeSlotMinutes);
  return slots.length > 0 ? slots : [ALL_DAY_SLOT];
}

export function timezoneLabel(tz: string): string {
  return TIMEZONES.find((t) => t.value === tz)?.label ?? tz;
}

/** Short human summary of date range + active days of week. */
export function describeSchedule(
  band: Pick<Band, "startDate" | "endDate" | "activeDays">
): string {
  const start = parseISO(band.startDate);
  const end = parseISO(band.endDate);
  const range =
    band.startDate === band.endDate
      ? format(start, "MMM d")
      : `${format(start, "MMM d")} – ${format(end, "MMM d")}`;

  const activeDays = new Set(band.activeDays ?? [0, 1, 2, 3, 4, 5, 6]);
  const isEveryDay = activeDays.size === 7;
  if (isEveryDay) return range;

  const dayLabels = DAYS_OF_WEEK.filter((d) => activeDays.has(d.value)).map((d) => d.short);
  return `${range}, ${dayLabels.join("/")}`;
}

/** Short human summary of location, or null if nothing meaningful is set. */
export function describeEvent(
  band: Pick<Band, "location" | "locationType">
): string | null {
  if (band.locationType === "virtual") return "Virtual";
  if (band.locationType === "tbd" && !band.location) return null;
  return band.location || null;
}
