import { db } from "@/db";
import { bands, bandMembers } from "@/db/schema";
import { and, eq, count } from "drizzle-orm";
import { getDateColumns, getTimeSlots } from "@/lib/band-settings";
import type { AvailabilityStatus } from "@/lib/constants";
import type {
  AggregateGrid,
  Band,
  BandWithAvailability,
  DateColumn,
  MemberWithAvailability,
  SlotCounts,
  AvailabilityRow,
} from "@/types";

export async function listBandsForLeader(
  leaderId: string
): Promise<(Band & { memberCount: number })[]> {
  const rows = await db
    .select({ band: bands, memberCount: count(bandMembers.id) })
    .from(bands)
    .leftJoin(bandMembers, eq(bandMembers.bandId, bands.id))
    .where(eq(bands.leaderId, leaderId))
    .groupBy(bands.id)
    .orderBy(bands.createdAt);

  return rows.map((r) => ({ ...r.band, memberCount: r.memberCount }));
}

/** Every band a linked member profile belongs to — for "Events you're in". */
export async function listBandsForMemberProfile(
  profileId: string
): Promise<{ member: (typeof bandMembers.$inferSelect); band: Band }[]> {
  const rows = await db
    .select({ member: bandMembers, band: bands })
    .from(bandMembers)
    .innerJoin(bands, eq(bands.id, bandMembers.bandId))
    .where(eq(bandMembers.profileId, profileId))
    .orderBy(bands.createdAt);

  return rows;
}

function emptySlotCounts(): SlotCounts {
  return {
    conflict: 0,
    maybe: 0,
    available: 0,
    preferred: 0,
    unfilled: 0,
    conflictNames: [],
    maybeNames: [],
    availableNames: [],
    preferredNames: [],
    unfilledNames: [],
  };
}

const NAME_KEY: Record<AvailabilityStatus | "unfilled", keyof SlotCounts> = {
  conflict: "conflictNames",
  maybe: "maybeNames",
  available: "availableNames",
  preferred: "preferredNames",
  unfilled: "unfilledNames",
};

export function buildAggregate(
  members: { name: string; grid: Record<string, Record<string, AvailabilityStatus | null>> }[],
  dateColumns: DateColumn[],
  timeSlots: string[]
): AggregateGrid {
  const grid: AggregateGrid = {};

  for (const col of dateColumns) {
    grid[col.date] = {};
    for (const slot of timeSlots) {
      const counts = emptySlotCounts();
      for (const member of members) {
        const status = member.grid[col.date]?.[slot];
        const bucket = status ?? "unfilled";
        counts[bucket] += 1;
        (counts[NAME_KEY[bucket]] as string[]).push(member.name);
      }
      grid[col.date][slot] = counts;
    }
  }

  return grid;
}

function buildMemberGrid(rows: AvailabilityRow[]): Record<string, Record<string, AvailabilityStatus>> {
  const grid: Record<string, Record<string, AvailabilityStatus>> = {};
  for (const row of rows) {
    grid[row.date] ??= {};
    grid[row.date][row.timeSlot] = row.status as AvailabilityStatus;
  }
  return grid;
}

/** Full band detail for the leader's dashboard: members, grids, aggregate. */
export async function getBandForLeader(
  bandId: string,
  leaderId: string
): Promise<BandWithAvailability | null> {
  const band = await db.query.bands.findFirst({
    where: and(eq(bands.id, bandId), eq(bands.leaderId, leaderId)),
    with: {
      members: {
        with: { availability: true },
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      },
      dayLabels: true,
    },
  });
  if (!band) return null;

  const members: MemberWithAvailability[] = band.members.map((m) => ({
    ...m,
    grid: buildMemberGrid(m.availability),
  }));

  const dateColumns = getDateColumns(band, band.dayLabels);
  const timeSlots = getTimeSlots(band);

  return {
    ...band,
    members,
    dayLabels: band.dayLabels,
    aggregate: buildAggregate(members, dateColumns, timeSlots),
  };
}

/** Just the band's settings fields, scoped to the leader — for the edit form. */
export async function getBandSettingsForLeader(
  bandId: string,
  leaderId: string
): Promise<Band | null> {
  const band = await db.query.bands.findFirst({
    where: and(eq(bands.id, bandId), eq(bands.leaderId, leaderId)),
  });
  return band ?? null;
}

export async function getBandBySlug(slug: string) {
  return db.query.bands.findFirst({
    where: eq(bands.slug, slug),
    with: {
      members: { columns: { id: true, name: true, instrument: true } },
    },
  });
}
