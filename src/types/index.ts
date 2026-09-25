import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  profiles,
  bands,
  bandMembers,
  bandDayLabels,
  availability,
} from "@/db/schema";
import type { AvailabilityStatus } from "@/lib/constants";

export type { DateColumn } from "@/lib/band-settings";

// ---------------------------------------------------------------------------
// DB row types (inferred from Drizzle schema)
// ---------------------------------------------------------------------------
export type Profile = InferSelectModel<typeof profiles>;
export type NewProfile = InferInsertModel<typeof profiles>;

export type Band = InferSelectModel<typeof bands>;
export type NewBand = InferInsertModel<typeof bands>;

export type BandMember = InferSelectModel<typeof bandMembers>;
export type NewBandMember = InferInsertModel<typeof bandMembers>;

export type BandDayLabel = InferSelectModel<typeof bandDayLabels>;

export type AvailabilityRow = InferSelectModel<typeof availability>;

// ---------------------------------------------------------------------------
// Composite / view types used across the app
// ---------------------------------------------------------------------------

/** grid[date][timeSlot] = status, for one member. */
export type MemberGrid = Record<string, Record<string, AvailabilityStatus>>;

export interface MemberWithAvailability extends BandMember {
  grid: MemberGrid;
}

/** Per-cell counts + who's-in-which-bucket, across all members. */
export interface SlotCounts {
  conflict: number;
  maybe: number;
  available: number;
  preferred: number;
  unfilled: number;
  conflictNames: string[];
  maybeNames: string[];
  availableNames: string[];
  preferredNames: string[];
  unfilledNames: string[];
}

/** aggregate[date][timeSlot] = counts across all members. */
export type AggregateGrid = Record<string, Record<string, SlotCounts>>;

export interface BandWithAvailability extends Band {
  members: MemberWithAvailability[];
  dayLabels: BandDayLabel[];
  aggregate: AggregateGrid;
}

export { type AvailabilityStatus };
