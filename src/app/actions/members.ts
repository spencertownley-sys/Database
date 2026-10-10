"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bandMembers, bands } from "@/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";
import { getCurrentProfile } from "@/lib/supabase/server";

function cleanOptional(value: string | undefined, maxLen: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) throw new ValidationError("That's a little long — try trimming it down.");
  return trimmed;
}

/**
 * No login: a member types their name once, and we find-or-create their row
 * in this band. The returned token is embedded in their personal link
 * (/a/[slug]/[token]) — that link IS their credential from then on.
 */
export async function joinBand(
  slug: string,
  name: string,
  instrument?: string,
  contact?: string
): Promise<ActionResult<{ token: string; memberName: string }>> {
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Enter your name to continue.");
    if (trimmed.length > 60) throw new ValidationError("That name's a little long.");
    const cleanInstrument = cleanOptional(instrument, 60);
    const cleanContact = cleanOptional(contact, 120);

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
      .values({ bandId: band.id, name: trimmed, instrument: cleanInstrument, contact: cleanContact })
      .returning();

    return { ok: true, data: { token: member.memberToken, memberName: member.name } };
  } catch (err) {
    return toActionError(err);
  }
}

/** Lets a member (no account) update their own name/role/contact from their personal link. */
export async function updateMemberProfile(
  slug: string,
  token: string,
  fields: { name: string; instrument?: string; contact?: string }
): Promise<ActionResult> {
  try {
    const trimmed = fields.name.trim();
    if (!trimmed) throw new ValidationError("Enter your name.");
    if (trimmed.length > 60) throw new ValidationError("That name's a little long.");
    const cleanInstrument = cleanOptional(fields.instrument, 60);
    const cleanContact = cleanOptional(fields.contact, 120);

    const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
    if (!band) throw new ValidationError("That link doesn't look right.");

    const member = await db.query.bandMembers.findFirst({
      where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
    });
    if (!member) throw new ValidationError("That link doesn't look right.");

    await db
      .update(bandMembers)
      .set({
        name: trimmed,
        instrument: cleanInstrument,
        contact: cleanContact,
        lastSeenAt: new Date(),
      })
      .where(eq(bandMembers.id, member.id));

    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * Links this anonymous member row to the signed-in account, so it shows up
 * on that account's dashboard. Requires Supabase and an active session.
 */
export async function claimMemberRow(slug: string, token: string): Promise<ActionResult> {
  try {
    const supabaseConfigured =
      !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseConfigured) {
      throw new ValidationError("Account linking isn't available in this environment.");
    }

    const profile = await getCurrentProfile();
    if (!profile) throw new ValidationError("Sign in first, then try again.");

    const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
    if (!band) throw new ValidationError("That link doesn't look right.");
    const member = await db.query.bandMembers.findFirst({
      where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
    });
    if (!member) throw new ValidationError("That link doesn't look right.");

    await db.update(bandMembers).set({ profileId: profile.id }).where(eq(bandMembers.id, member.id));

    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
