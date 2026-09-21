import { db } from "@/db";
import { bands, bandMembers } from "@/db/schema";
import { and, eq, count } from "drizzle-orm";
import { DAYS_OF_WEEK, TIME_BLOCKS, type AvailabilityStatus, type TimeBlock } from "@/lib/constants";
import type {
  AggregateGrid,
  Band,
  BandWithAvailability,
  MemberWithAvailability,
  SlotCounts,
  WeeklyGrid,
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

function emptySlotCounts(): SlotCounts {
  return { available: 0, maybe: 0, unavailable: 0, total: 0 };
}

function buildAggregate(members: MemberWithAvailability[]): AggregateGrid {
  const grid: AggregateGrid = {};
  for (const day of DAYS_OF_WEEK) {
    grid[day.value] = {};
    for (const block of TIME_BLOCKS) {
      const counts = emptySlotCounts();
      for (const member of members) {
        const status = member.weeklyGrid[day.value]?.[block.value] ?? "unavailable";
        counts[status] += 1;
        counts.total += 1;
      }
      grid[day.value]![block.value] = counts;
    }
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
        with: { weeklyAvailability: true, exceptions: true },
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      },
    },
  });
  if (!band) return null;

  const members: MemberWithAvailability[] = band.members.map((m) => {
    const weeklyGrid: WeeklyGrid = {};
    for (const row of m.weeklyAvailability) {
      weeklyGrid[row.dayOfWeek] ??= {};
      weeklyGrid[row.dayOfWeek]![row.timeBlock as TimeBlock] =
        row.status as AvailabilityStatus;
    }
    return {
      ...m,
      weeklyGrid,
      exceptions: [...m.exceptions].sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  return {
    ...band,
    members,
    aggregate: buildAggregate(members),
  };
}

export async function getBandBySlug(slug: string) {
  return db.query.bands.findFirst({
    where: eq(bands.slug, slug),
    with: {
      members: { columns: { id: true, name: true, instrument: true } },
    },
  });
}
