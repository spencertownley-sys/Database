"use server";

import { db } from "@/db";
import { bandMembers, bands } from "@/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";

/**
 * No login: a member types their name once, and we find-or-create their row
 * in this band. The returned token is embedded in their personal link
 * (/a/[slug]/[token]) — that link IS their credential from then on.
 */
export async function joinBand(
  slug: string,
  name: string
): Promise<ActionResult<{ token: string; memberName: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Enter your name to continue.");
    if (trimmed.length > 60) throw new ValidationError("That name's a little long.");

    const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
    if (!band) throw new ValidationError("That link doesn't look right — check it and try again.");

    const existing = await db.query.bandMembers.findFirst({
      where: and(eq(bandMembers.bandId, band.id), ilike(bandMembers.name, trimmed)),
    });
    if (existing) {
      await db
        .update(bandMembers)
        .set({ lastSeenAt: new Date() })
        .where(eq(bandMembers.id, existing.id));
      return { ok: true, data: { token: existing.memberToken, memberName: existing.name } };
    }

    const [member] = await db
      .insert(bandMembers)
      .values({ bandId: band.id, name: trimmed })
      .returning();

    return { ok: true, data: { token: member.memberToken, memberName: member.name } };
  } catch (err) {
    return toActionError(err);
  }
}
