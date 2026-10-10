"use server";

import { revalidatePath } from "next/cache";
import { sql, or, and, eq } from "drizzle-orm";
import { db } from "@/db";
import { availability, bandMembers, bands } from "@/db/schema";
import { AVAILABILITY_STATUSES, type AvailabilityStatus } from "@/lib/constants";
import { toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";

export interface AvailabilityUpdate {
  date: string; // yyyy-MM-dd
  timeSlot: string; // "HH:MM" or ALL_DAY_SLOT
  /** null clears the cell entirely (deletes the row) instead of setting a status. */
  status: AvailabilityStatus | null;
}

async function requireMember(slug: string, token: string) {
  const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
  if (!band) throw new ValidationError("That link doesn't look right.");
  const member = await db.query.bandMembers.findFirst({
    where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
  });
  if (!member) throw new ValidationError("That link doesn't look right.");
  return member;
}

/** Validates the member token, then upserts all cell changes in one batch. */
export async function setAvailabilityBulk(
  slug: string,
  token: string,
  updates: AvailabilityUpdate[]
): Promise<ActionResult> {
  try {
    const member = await requireMember(slug, token);
    if (!updates || updates.length === 0) return { ok: true };

    for (const u of updates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date)) throw new ValidationError("Invalid date.");
      if (!u.timeSlot) throw new ValidationError("Invalid time slot.");
      if (u.status !== null && !AVAILABILITY_STATUSES.includes(u.status)) {
        throw new ValidationError("Unknown availability status.");
      }
    }

    const sets = updates.filter((u) => u.status !== null) as (AvailabilityUpdate & {
      status: AvailabilityStatus;
    })[];
    const clears = updates.filter((u) => u.status === null);

    const now = new Date();
    if (sets.length > 0) {
      // Multi-row insert with onConflictDoUpdate; each row keeps its own new
      // status via a reference to the excluded (proposed) row.
      await db
        .insert(availability)
        .values(
          sets.map((u) => ({
            memberId: member.id,
            date: u.date,
            timeSlot: u.timeSlot,
            status: u.status,
            updatedAt: now,
          }))
        )
        .onConflictDoUpdate({
          target: [availability.memberId, availability.date, availability.timeSlot],
          set: { status: sql`excluded.status`, updatedAt: now },
        });
    }

    if (clears.length > 0) {
      // A true unset: delete the row entirely rather than storing a status,
      // so the cell reverts to "not yet responded" instead of some value.
      await db.delete(availability).where(
        and(
          eq(availability.memberId, member.id),
          or(
            ...clears.map((u) =>
              and(eq(availability.date, u.date), eq(availability.timeSlot, u.timeSlot))
            )
          )
        )
      );
    }

    revalidatePath(`/a/${slug}/${token}`);
    revalidatePath(`/dashboard`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
