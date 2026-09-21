"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { availabilityExceptions, availabilityWeekly, bandMembers, bands } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { AVAILABILITY_STATUSES, TIME_BLOCKS, type AvailabilityStatus } from "@/lib/constants";
import { toActionError } from "./helpers";
import { ValidationError, type ActionResult } from "@/lib/action-errors";

async function requireMember(slug: string, token: string) {
  const band = await db.query.bands.findFirst({ where: eq(bands.slug, slug) });
  if (!band) throw new ValidationError("That link doesn't look right.");
  const member = await db.query.bandMembers.findFirst({
    where: and(eq(bandMembers.memberToken, token), eq(bandMembers.bandId, band.id)),
  });
  if (!member) throw new ValidationError("That link doesn't look right.");
  return member;
}

function assertStatus(status: string): asserts status is AvailabilityStatus {
  if (!AVAILABILITY_STATUSES.includes(status as AvailabilityStatus)) {
    throw new ValidationError("Unknown availability status.");
  }
}

export async function setWeeklyStatus(
  slug: string,
  token: string,
  dayOfWeek: number,
  timeBlock: string,
  status: string
): Promise<ActionResult> {
  try {
    const member = await requireMember(slug, token);
    if (dayOfWeek < 0 || dayOfWeek > 6) throw new ValidationError("Invalid day.");
    if (!TIME_BLOCKS.some((b) => b.value === timeBlock)) {
      throw new ValidationError("Invalid time block.");
    }
    assertStatus(status);

    await db
      .insert(availabilityWeekly)
      .values({ memberId: member.id, dayOfWeek, timeBlock, status, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [availabilityWeekly.memberId, availabilityWeekly.dayOfWeek, availabilityWeekly.timeBlock],
        set: { status, updatedAt: new Date() },
      });

    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setExceptionStatus(
  slug: string,
  token: string,
  date: string,
  status: string,
  note?: string
): Promise<ActionResult> {
  try {
    const member = await requireMember(slug, token);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Invalid date.");
    assertStatus(status);

    await db
      .insert(availabilityExceptions)
      .values({ memberId: member.id, date, status, note: note?.trim() || null })
      .onConflictDoUpdate({
        target: [availabilityExceptions.memberId, availabilityExceptions.date],
        set: { status, note: note?.trim() || null },
      });

    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeException(
  slug: string,
  token: string,
  date: string
): Promise<ActionResult> {
  try {
    const member = await requireMember(slug, token);
    await db
      .delete(availabilityExceptions)
      .where(
        and(eq(availabilityExceptions.memberId, member.id), eq(availabilityExceptions.date, date))
      );
    revalidatePath(`/a/${slug}/${token}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
