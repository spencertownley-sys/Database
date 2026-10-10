"use server";

import { getCurrentProfile } from "@/lib/supabase/server";
import { ValidationError, type ActionResult } from "@/lib/action-errors";
import type { Profile } from "@/types";

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not authenticated");
  return profile;
}

export async function toActionError(err: unknown): Promise<ActionResult<never>> {
  console.error(err);
  if (err instanceof ValidationError) {
    return { ok: false, error: err.message };
  }
  if (err instanceof Error && err.message === "Not authenticated") {
    return { ok: false, error: "You must be signed in." };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}
