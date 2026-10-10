import { db } from "@/db";
import { bandMembers, bands } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { AvailabilityStatus } from "@/lib/constants";
import type { BandDayLabel, MemberWithAvailability } from "@/types";

/**
 * Look up a band member by their bearer token, scoped to the band slug in
 * the URL so a token from one band can't be replayed against another.
 * This — not a Supabase session — is how members prove who they are.
 */
export async function getMemberByToken(
  slug: string,
  token: string
): Promise<{
  band: NonNullable<Awaited<ReturnType<typeof getBandForToken>>>;
  dayLabels: BandDayLabel[];
  member: MemberWithAvailability;
} | null> {
  const band = await getBandForToken(slug);
  if (!band) return null;

  const member = await db.query.bandMembers.findFirst({
    where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
    with: { availability: true },
  });
  if (!member) return null;

  // Bump lastSeenAt on lookup.
  await db
    .update(bandMembers)
    .set({ lastSeenAt: new Date() })
    .where(eq(bandMembers.id, member.id));

  const grid: Record<string, Record<string, AvailabilityStatus>> = {};
  for (const row of member.availability) {
    grid[row.date] ??= {};
    grid[row.date][row.timeSlot] = row.status as AvailabilityStatus;
  }

  return {
    band,
    dayLabels: band.dayLabels,
    member: { ...member, grid },
  };
}

async function getBandForToken(slug: string) {
  return db.query.bands.findFirst({
    where: eq(bands.slug, slug),
    with: { dayLabels: true },
  });
}
