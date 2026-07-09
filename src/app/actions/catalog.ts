"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { voyages, ships, disclaimers, audienceSegments } from "@/db/schema";
import { eq, max } from "drizzle-orm";
import {
  requirePermission,
  logActivity,
  toActionError,
  type ActionResult,
} from "./helpers";
import type { VoyageMetadata, AudienceCriteria } from "@/types";

// ---------------------------------------------------------------------------
// Voyages (PIM)
// ---------------------------------------------------------------------------
export async function updateVoyageMetadata(
  voyageId: string,
  metadata: VoyageMetadata
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    const [before] = await db
      .select({ metadata: voyages.metadata })
      .from(voyages)
      .where(eq(voyages.id, voyageId))
      .limit(1);
    if (!before) return { ok: false, error: "Voyage not found." };

    await db
      .update(voyages)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(voyages.id, voyageId));

    await logActivity({
      entityType: "voyage",
      entityId: voyageId,
      action: "updated",
      changes: { metadata: { old: before.metadata, new: metadata } },
      performedBy: profile.id,
    });

    revalidatePath(`/voyages/${voyageId}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Ships (PIM)
// ---------------------------------------------------------------------------
export async function updateShip(
  shipId: string,
  input: {
    homePort?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    const [before] = await db
      .select()
      .from(ships)
      .where(eq(ships.id, shipId))
      .limit(1);
    if (!before) return { ok: false, error: "Ship not found." };

    await db
      .update(ships)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(ships.id, shipId));

    await logActivity({
      entityType: "ship",
      entityId: shipId,
      action: "updated",
      changes: Object.fromEntries(
        Object.entries(input).map(([k, v]) => [
          k,
          { old: (before as Record<string, unknown>)[k], new: v },
        ])
      ),
      performedBy: profile.id,
    });

    revalidatePath("/ships");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Disclaimers — versioned: editing an approved disclaimer creates a new version
// ---------------------------------------------------------------------------
export async function createDisclaimer(input: {
  name: string;
  disclaimerText: string;
  appliesToOfferTypes: string[];
  effectiveDate?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const profile = await requirePermission("canCreate");
    if (!input.name.trim() || !input.disclaimerText.trim()) {
      return { ok: false, error: "Name and disclaimer text are required." };
    }
    const [existing] = await db
      .select({ maxVersion: max(disclaimers.version) })
      .from(disclaimers)
      .where(eq(disclaimers.name, input.name));
    const version = (existing?.maxVersion ?? 0) + 1;

    const [row] = await db
      .insert(disclaimers)
      .values({
        name: input.name,
        disclaimerText: input.disclaimerText,
        appliesToOfferTypes: input.appliesToOfferTypes,
        effectiveDate: input.effectiveDate || null,
        version,
        status: "draft",
      })
      .returning({ id: disclaimers.id });

    await logActivity({
      entityType: "disclaimer",
      entityId: row.id,
      action: "created",
      changes: { version: { old: null, new: version } },
      performedBy: profile.id,
    });

    revalidatePath("/disclaimers");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateDisclaimer(
  id: string,
  input: {
    disclaimerText?: string;
    appliesToOfferTypes?: string[];
    effectiveDate?: string | null;
    expiryDate?: string | null;
  }
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    const [before] = await db
      .select()
      .from(disclaimers)
      .where(eq(disclaimers.id, id))
      .limit(1);
    if (!before) return { ok: false, error: "Disclaimer not found." };
    if (before.status !== "draft") {
      return {
        ok: false,
        error: "Only draft disclaimers can be edited. Create a new version instead.",
      };
    }

    await db
      .update(disclaimers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(disclaimers.id, id));

    await logActivity({
      entityType: "disclaimer",
      entityId: id,
      action: "updated",
      changes: input.disclaimerText
        ? { disclaimer_text: { old: before.disclaimerText, new: input.disclaimerText } }
        : null,
      performedBy: profile.id,
    });

    revalidatePath("/disclaimers");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function changeDisclaimerStatus(
  id: string,
  status: "draft" | "approved" | "retired"
): Promise<ActionResult> {
  try {
    const profile =
      status === "approved"
        ? await requirePermission("canApprove")
        : await requirePermission("canCreate");

    const [before] = await db
      .select()
      .from(disclaimers)
      .where(eq(disclaimers.id, id))
      .limit(1);
    if (!before) return { ok: false, error: "Disclaimer not found." };

    await db
      .update(disclaimers)
      .set({
        status,
        updatedAt: new Date(),
        ...(status === "approved"
          ? { legalApprovedBy: profile.fullName, legalApprovedAt: new Date() }
          : {}),
      })
      .where(eq(disclaimers.id, id));

    await logActivity({
      entityType: "disclaimer",
      entityId: id,
      action: "status_changed",
      changes: { status: { old: before.status, new: status } },
      performedBy: profile.id,
    });

    revalidatePath("/disclaimers");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Audience segments
// ---------------------------------------------------------------------------
export async function upsertAudienceSegment(input: {
  id?: string;
  name: string;
  description?: string;
  criteria?: AudienceCriteria;
  estimatedSize?: number | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const profile = await requirePermission("canCreate");
    if (!input.name.trim()) {
      return { ok: false, error: "Segment name is required." };
    }

    if (input.id) {
      await db
        .update(audienceSegments)
        .set({
          name: input.name,
          description: input.description ?? null,
          criteria: input.criteria ?? {},
          estimatedSize: input.estimatedSize ?? null,
        })
        .where(eq(audienceSegments.id, input.id));
      await logActivity({
        entityType: "audience_segment",
        entityId: input.id,
        action: "updated",
        performedBy: profile.id,
      });
      revalidatePath("/audiences");
      return { ok: true, data: { id: input.id } };
    }

    const [row] = await db
      .insert(audienceSegments)
      .values({
        name: input.name,
        description: input.description ?? null,
        criteria: input.criteria ?? {},
        estimatedSize: input.estimatedSize ?? null,
      })
      .returning({ id: audienceSegments.id });

    await logActivity({
      entityType: "audience_segment",
      entityId: row.id,
      action: "created",
      performedBy: profile.id,
    });

    revalidatePath("/audiences");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return toActionError(err);
  }
}
