import { db } from "@/db";
import { bandMembers, bands } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { AvailabilityStatus, TimeBlock } from "@/lib/constants";
import type { MemberWithAvailability, WeeklyGrid } from "@/types";

/**
 * Look up a band member by their bearer token, scoped to the band slug in
 * the URL so a token from one band can't be replayed against another.
 * This — not a Supabase session — is how members prove who they are.
 */
export async function getMemberByToken(
  slug: string,
  token: string
): Promise<{ bandName: string; bandId: string; member: MemberWithAvailability } | null> {
  const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
  if (!band) return null;

  const member = await db.query.bandMembers.findFirst({
    where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
    with: { weeklyAvailability: true, exceptions: true },
  });
  if (!member) return null;

  const weeklyGrid: WeeklyGrid = {};
  for (const row of member.weeklyAvailability) {
    weeklyGrid[row.dayOfWeek] ??= {};
    weeklyGrid[row.dayOfWeek]![row.timeBlock as TimeBlock] = row.status as AvailabilityStatus;
  }

  return {
    bandName: band.name,
    bandId: band.id,
    member: {
      ...member,
      weeklyGrid,
      exceptions: [...member.exceptions].sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}
