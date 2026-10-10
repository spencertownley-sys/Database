export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

// ---------------------------------------------------------------------------
// Event setup
// ---------------------------------------------------------------------------
export const SCHEDULE_TYPES = [
  {
    value: "date_time",
    label: "Specific dates & times",
    hint: "Members mark availability per time slot, per date",
  },
  {
    value: "date_only",
    label: "Specific dates, all day",
    hint: "Members mark availability per date, no time slots",
  },
] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number]["value"];

export const LOCATION_TYPES = [
  { value: "in_person", label: "In person" },
  { value: "virtual", label: "Virtual" },
  { value: "tbd", label: "To be decided" },
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number]["value"];

// A reasonable curated list of IANA zones for a US-leaning band-scheduling app.
export const TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
  { value: "America/Toronto", label: "Eastern Time — Canada" },
  { value: "America/Vancouver", label: "Pacific Time — Canada" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European Time" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "UTC", label: "UTC" },
] as const;

// Sentinel time-slot value meaning "no specific time, just a day."
export const ALL_DAY_SLOT = "all_day";

/** Generates ["17:00", "18:00", ...] between start and end (exclusive of end), stepMinutes apart. */
export function generateTimeSlots(
  startHHMM: string,
  endHHMM: string,
  stepMinutes: number
): string[] {
  const [startH, startM] = startHHMM.split(":").map(Number);
  const [endH, endM] = endHHMM.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  const step = stepMinutes > 0 ? stepMinutes : 30;

  const slots: string[] = [];
  for (let t = startTotal; t < endTotal; t += step) {
    const h = Math.floor(t / 60) % 24;
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

/** "17:00" -> "5:00 PM" */
export function formatTimeSlot(hhmm: string): string {
  if (hhmm === ALL_DAY_SLOT) return "All day";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// ---------------------------------------------------------------------------
// Availability status — a 4-tier palette the member picks from directly.
// ---------------------------------------------------------------------------
export const AVAILABILITY_STATUSES = ["conflict", "maybe", "available", "preferred"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const STATUS_META: Record<
  AvailabilityStatus,
  { label: string; cellClass: string; dotClass: string }
> = {
  conflict: {
    label: "Conflict",
    cellClass: "bg-red-500 hover:bg-red-600 text-white",
    dotClass: "bg-red-500",
  },
  maybe: {
    label: "Maybe",
    cellClass: "bg-amber-400 hover:bg-amber-500 text-white",
    dotClass: "bg-amber-400",
  },
  available: {
    label: "Available",
    cellClass: "bg-emerald-500 hover:bg-emerald-600 text-white",
    dotClass: "bg-emerald-500",
  },
  preferred: {
    label: "Preferred",
    cellClass: "bg-blue-500 hover:bg-blue-600 text-white",
    dotClass: "bg-blue-500",
  },
};

export const UNFILLED_META = {
  label: "Not yet responded",
  cellClass: "bg-secondary hover:bg-muted text-muted-foreground",
  dotClass: "bg-border",
};
