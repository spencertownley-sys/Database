"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import {
  requireProfile,
  logActivity,
  toActionError,
  type ActionResult,
} from "./helpers";

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<ActionResult> {
  try {
    const actor = await requireProfile();
    if (actor.role !== "admin") {
      return { ok: false, error: "Only admins can change user roles." };
    }
    if (!(role in USER_ROLES)) {
      return { ok: false, error: "Unknown role." };
    }
    if (actor.id === userId && role !== "admin") {
      return { ok: false, error: "You can't remove your own admin role." };
    }

    const [before] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    if (!before) return { ok: false, error: "User not found." };

    await db.update(profiles).set({ role }).where(eq(profiles.id, userId));

    await logActivity({
      entityType: "profile",
      entityId: userId,
      action: "role_changed",
      changes: { role: { old: before.role, new: role } },
      performedBy: actor.id,
    });

    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
