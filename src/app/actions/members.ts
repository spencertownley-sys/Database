"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bandMembers, bands } from "@/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";
import { getCurrentProfile } from "@/lib/supabase/server";

/**
 * No login required: a member types their name once, and we find-or-create
 * their row in this band. The returned token is embedded in their personal
 * link (/a/[slug]/[token]) — that link IS their credential from then on.
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
      .values({
        bandId: band.id,
        name: trimmed,
        instrument: instrument?.trim() || null,
        contact: contact?.trim() || null,
      })
      .returning();

    return { ok: true, data: { token: member.memberToken, memberName: member.name } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateMemberProfile(
  slug: string,
  token: string,
  updates: { name?: string; instrument?: string; contact?: string }
): Promise<ActionResult> {
  try {
    const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
    if (!band) throw new ValidationError("That link doesn't look right.");
    const member = await db.query.bandMembers.findFirst({
      where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
    });
    if (!member) throw new ValidationError("That link doesn't look right.");

    const name = updates.name?.trim();
    if (name !== undefined && !name) throw new ValidationError("Name can't be empty.");

    await db
      .update(bandMembers)
      .set({
        ...(name ? { name } : {}),
        ...(updates.instrument !== undefined ? { instrument: updates.instrument.trim() || null } : {}),
        ...(updates.contact !== undefined ? { contact: updates.contact.trim() || null } : {}),
      })
      .where(eq(bandMembers.id, member.id));

    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * If there's a current Supabase session, link this anonymous member row to
 * the logged-in account. No-op / error if Supabase isn't configured or no
 * session exists — the caller should prompt login first in that case.
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
