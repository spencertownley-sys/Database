"use server";

import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import type { ActivityChanges, Profile } from "@/types";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not authenticated");
  return profile;
}

export async function requirePermission(
  permission: "canCreate" | "canApprove" | "canDelete" | "canViewReports"
): Promise<Profile> {
  const profile = await requireProfile();
  const role = (profile.role in USER_ROLES ? profile.role : "viewer") as UserRole;
  if (!USER_ROLES[role][permission]) {
    throw new Error("You don't have permission to perform this action.");
  }
  return profile;
}

export async function logActivity(params: {
  entityType: string;
  entityId: string;
  action: string;
  changes?: ActivityChanges | null;
  performedBy?: string | null;
}) {
  try {
    await db.insert(activityLog).values({
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changes: params.changes ?? null,
      performedBy: params.performedBy ?? null,
    });
  } catch (err) {
    // Audit logging must never break the mutation itself.
    console.error("activity_log insert failed", err);
  }
}

export async function toActionError(err: unknown): Promise<ActionResult<never>> {
  console.error(err);
  const message =
    err instanceof Error && err.message.startsWith("You don't have permission")
      ? err.message
      : err instanceof Error && err.message === "Not authenticated"
        ? "You must be signed in."
        : "Something went wrong. Please try again.";
  return { ok: false, error: message };
}
