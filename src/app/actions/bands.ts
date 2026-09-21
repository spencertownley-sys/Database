"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { bands } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { generateSlug } from "@/lib/slug";
import { requireProfile, toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";
import type { Band } from "@/types";

export async function createBand(name: string): Promise<ActionResult<Band>> {
  try {
    const profile = await requireProfile();
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Give your band a name.");
    if (trimmed.length > 80) throw new ValidationError("That name's a little long.");

    // Practically never collides, but guard against it anyway.
    let slug = generateSlug();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
      if (!existing) break;
      slug = generateSlug();
    }

    const [band] = await db
      .insert(bands)
      .values({ name: trimmed, slug, leaderId: profile.id })
      .returning();

    revalidatePath("/dashboard");
    return { ok: true, data: band };
  } catch (err) {
    return toActionError(err);
  }
}

export async function renameBand(bandId: string, name: string): Promise<ActionResult> {
  try {
    const profile = await requireProfile();
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError("Give your band a name.");

    const [updated] = await db
      .update(bands)
      .set({ name: trimmed })
      .where(and(eq(bands.id, bandId), eq(bands.leaderId, profile.id)))
      .returning();
    if (!updated) throw new ValidationError("Band not found.");

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/bands/${bandId}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteBand(bandId: string): Promise<ActionResult> {
  try {
    const profile = await requireProfile();
    await db.delete(bands).where(and(eq(bands.id, bandId), eq(bands.leaderId, profile.id)));
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
