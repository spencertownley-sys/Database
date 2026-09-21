import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  profiles,
  bands,
  bandMembers,
  availabilityWeekly,
  availabilityExceptions,
} from "@/db/schema";
import type { AvailabilityStatus, TimeBlock } from "@/lib/constants";

// ---------------------------------------------------------------------------
// DB row types (inferred from Drizzle schema)
// ---------------------------------------------------------------------------
export type Profile = InferSelectModel<typeof profiles>;
export type NewProfile = InferInsertModel<typeof profiles>;

export type Band = InferSelectModel<typeof bands>;
export type NewBand = InferInsertModel<typeof bands>;

export type BandMember = InferSelectModel<typeof bandMembers>;
export type NewBandMember = InferInsertModel<typeof bandMembers>;

export type WeeklyAvailabilityRow = InferSelectModel<typeof availabilityWeekly>;
export type AvailabilityException = InferSelectModel<typeof availabilityExceptions>;

// ---------------------------------------------------------------------------
// Composite / view types used across the app
// ---------------------------------------------------------------------------

/** grid[dayOfWeek][timeBlock] = status, for one member. */
export type WeeklyGrid = Record<number, Partial<Record<TimeBlock, AvailabilityStatus>>>;

export interface MemberWithAvailability extends BandMember {
  weeklyGrid: WeeklyGrid;
  exceptions: AvailabilityException[];
}

/** aggregateGrid[dayOfWeek][timeBlock] = counts across all members. */
export interface SlotCounts {
  available: number;
  maybe: number;
  unavailable: number;
  total: number;
}
export type AggregateGrid = Record<number, Partial<Record<TimeBlock, SlotCounts>>>;

export interface BandWithAvailability extends Band {
  members: MemberWithAvailability[];
  aggregate: AggregateGrid;
}

export { type AvailabilityStatus, type TimeBlock };
