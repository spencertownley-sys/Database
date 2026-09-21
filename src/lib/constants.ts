export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
] as const;

export const TIME_BLOCKS = [
  { value: "morning", label: "Morning", hint: "8am – 12pm" },
  { value: "afternoon", label: "Afternoon", hint: "12pm – 5pm" },
  { value: "evening", label: "Evening", hint: "5pm – 9pm" },
  { value: "night", label: "Night", hint: "9pm – late" },
] as const;

export type TimeBlock = (typeof TIME_BLOCKS)[number]["value"];

export const AVAILABILITY_STATUSES = ["available", "maybe", "unavailable"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

// Clicking a cell cycles through this order.
export const STATUS_CYCLE: AvailabilityStatus[] = ["unavailable", "available", "maybe"];

export const STATUS_META: Record<
  AvailabilityStatus,
  { label: string; cellClass: string; dotClass: string }
> = {
  available: {
    label: "Available",
    cellClass: "bg-emerald-500 hover:bg-emerald-600 text-white",
    dotClass: "bg-emerald-500",
  },
  maybe: {
    label: "Maybe",
    cellClass: "bg-amber-400 hover:bg-amber-500 text-white",
    dotClass: "bg-amber-400",
  },
  unavailable: {
    label: "Not available",
    cellClass: "bg-secondary hover:bg-muted text-muted-foreground",
    dotClass: "bg-border",
  },
};
