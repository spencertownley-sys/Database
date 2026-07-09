"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  promotions,
  promoVoyages,
  promoDisclaimers,
  promoAudiences,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  STATUS_TRANSITIONS,
  APPROVAL_REQUIRED_STATUSES,
  USER_ROLES,
  type PromoStatus,
  type UserRole,
} from "@/lib/constants";
import {
  requireProfile,
  requirePermission,
  logActivity,
  toActionError,
  type ActionResult,
} from "./helpers";
import type { ActivityChanges, NewPromotion } from "@/types";

const EDITABLE_FIELDS = [
  "promoName",
  "promoCode",
  "description",
  "offerType",
  "offerValue",
  "offerDetails",
  "sellStartDate",
  "sellEndDate",
  "sailStartDate",
  "sailEndDate",
  "market",
  "bookingChannels",
  "isCombinable",
  "source",
  "priority",
  "notes",
  "tags",
  "headline",
  "termsSummary",
  "content",
] as const;

type PromoInput = Partial<Pick<NewPromotion, (typeof EDITABLE_FIELDS)[number]>>;

function sanitize(input: PromoInput): PromoInput {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in input) out[key] = (input as Record<string, unknown>)[key];
  }
  // Normalize empty strings on nullable fields
  for (const k of ["promoCode", "sailStartDate", "sailEndDate", "description", "notes", "headline", "termsSummary", "source"]) {
    if (out[k] === "") out[k] = null;
  }
  return out as PromoInput;
}

export async function createPromotion(
  input: PromoInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const profile = await requirePermission("canCreate");
    const values = sanitize(input);
    if (!values.promoName || !values.offerType || !values.offerValue) {
      return { ok: false, error: "Name, offer type, and offer value are required." };
    }
    if (!values.sellStartDate || !values.sellEndDate) {
      return { ok: false, error: "Sell start and end dates are required." };
    }
    if (values.sellEndDate < values.sellStartDate) {
      return { ok: false, error: "Sell end date must be after the start date." };
    }

    const [row] = await db
      .insert(promotions)
      .values({
        ...(values as NewPromotion),
        status: "draft",
        ownerId: profile.id,
      })
      .returning({ id: promotions.id });

    await logActivity({
      entityType: "promotion",
      entityId: row.id,
      action: "created",
      changes: { status: { old: null, new: "draft" } },
      performedBy: profile.id,
    });

    revalidatePath("/promotions");
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updatePromotion(
  id: string,
  input: PromoInput
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    const values = sanitize(input);
    if (values.sellStartDate && values.sellEndDate && values.sellEndDate < values.sellStartDate) {
      return { ok: false, error: "Sell end date must be after the start date." };
    }

    const [before] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    if (!before) return { ok: false, error: "Promotion not found." };

    await db
      .update(promotions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(promotions.id, id));

    const changes: ActivityChanges = {};
    for (const [k, v] of Object.entries(values)) {
      const old = (before as Record<string, unknown>)[k];
      if (JSON.stringify(old) !== JSON.stringify(v)) {
        changes[k] = { old, new: v };
      }
    }
    if (Object.keys(changes).length > 0) {
      await logActivity({
        entityType: "promotion",
        entityId: id,
        action: "updated",
        changes,
        performedBy: profile.id,
      });
    }

    revalidatePath("/promotions");
    revalidatePath(`/promotions/${id}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function changePromoStatus(
  id: string,
  newStatus: PromoStatus
): Promise<ActionResult> {
  try {
    const profile = await requireProfile();
    const role = (profile.role in USER_ROLES ? profile.role : "viewer") as UserRole;

    const [promo] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    if (!promo) return { ok: false, error: "Promotion not found." };

    const current = promo.status as PromoStatus;
    if (!STATUS_TRANSITIONS[current]?.includes(newStatus)) {
      return {
        ok: false,
        error: `Cannot move from '${current}' to '${newStatus}'.`,
      };
    }
    if (
      APPROVAL_REQUIRED_STATUSES.includes(newStatus) &&
      !USER_ROLES[role].canApprove
    ) {
      return {
        ok: false,
        error: "Only managers and admins can approve or launch promotions.",
      };
    }
    if (!USER_ROLES[role].canCreate) {
      return { ok: false, error: "You don't have permission to change status." };
    }

    // Launch readiness checks: approved → live
    if (newStatus === "live") {
      const [checks] = (await db.execute<{
        voyages: number;
        disclaimers: number;
        audiences: number;
      }>(sql`
        SELECT
          (SELECT count(*) FROM promo_voyages WHERE promo_id = ${id})::int AS voyages,
          (SELECT count(*) FROM promo_disclaimers WHERE promo_id = ${id})::int AS disclaimers,
          (SELECT count(*) FROM promo_audiences WHERE promo_id = ${id})::int AS audiences
      `)) as unknown as { voyages: number; disclaimers: number; audiences: number }[];
      const missing = [];
      if (!checks.voyages) missing.push("linked voyages");
      if (!checks.disclaimers) missing.push("a disclaimer");
      if (!checks.audiences) missing.push("an audience");
      if (missing.length > 0) {
        return {
          ok: false,
          error: `Cannot go live without ${missing.join(", ")}.`,
        };
      }
    }

    const isApproval = newStatus === "approved";
    await db
      .update(promotions)
      .set({
        status: newStatus,
        updatedAt: new Date(),
        ...(isApproval
          ? { approvedBy: profile.id, approvedAt: new Date() }
          : {}),
      })
      .where(eq(promotions.id, id));

    await logActivity({
      entityType: "promotion",
      entityId: id,
      action: isApproval ? "approved" : "status_changed",
      changes: { status: { old: current, new: newStatus } },
      performedBy: profile.id,
    });

    revalidatePath("/promotions");
    revalidatePath(`/promotions/${id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function bulkChangePromoStatus(
  ids: string[],
  newStatus: PromoStatus
): Promise<ActionResult<{ updated: number; skipped: number }>> {
  try {
    let updated = 0;
    let skipped = 0;
    for (const id of ids) {
      const result = await changePromoStatus(id, newStatus);
      if (result.ok) updated++;
      else skipped++;
    }
    return { ok: true, data: { updated, skipped } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deletePromotion(id: string): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canDelete");
    const [promo] = await db
      .select({ name: promotions.promoName })
      .from(promotions)
      .where(eq(promotions.id, id))
      .limit(1);
    if (!promo) return { ok: false, error: "Promotion not found." };

    // Cascades clean up promo_voyages / promo_disclaimers / promo_audiences.
    await db.delete(promotions).where(eq(promotions.id, id));

    await logActivity({
      entityType: "promotion",
      entityId: id,
      action: "deleted",
      changes: { promo_name: { old: promo.name, new: null } },
      performedBy: profile.id,
    });

    revalidatePath("/promotions");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Voyage linking — batch inserts, never row-at-a-time.
// ---------------------------------------------------------------------------
export async function linkVoyages(
  promoId: string,
  voyageIds: string[]
): Promise<ActionResult<{ linked: number }>> {
  try {
    const profile = await requirePermission("canCreate");
    if (voyageIds.length === 0) return { ok: true, data: { linked: 0 } };

    const values = voyageIds.map((voyageId) => ({
      promoId,
      voyageId,
      addedBy: profile.id,
    }));
    let linked = 0;
    for (let i = 0; i < values.length; i += 1000) {
      const batch = values.slice(i, i + 1000);
      const inserted = await db
        .insert(promoVoyages)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: promoVoyages.id });
      linked += inserted.length;
    }

    await logActivity({
      entityType: "promotion",
      entityId: promoId,
      action: "voyages_linked",
      changes: { voyages_added: { old: null, new: linked } },
      performedBy: profile.id,
    });

    revalidatePath(`/promotions/${promoId}/voyages`);
    revalidatePath(`/promotions/${promoId}`);
    return { ok: true, data: { linked } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function unlinkVoyages(
  promoId: string,
  voyageIds: string[]
): Promise<ActionResult<{ removed: number }>> {
  try {
    const profile = await requirePermission("canCreate");
    if (voyageIds.length === 0) return { ok: true, data: { removed: 0 } };

    const removed = await db
      .delete(promoVoyages)
      .where(
        and(
          eq(promoVoyages.promoId, promoId),
          inArray(promoVoyages.voyageId, voyageIds)
        )
      )
      .returning({ id: promoVoyages.id });

    await logActivity({
      entityType: "promotion",
      entityId: promoId,
      action: "voyages_unlinked",
      changes: { voyages_removed: { old: null, new: removed.length } },
      performedBy: profile.id,
    });

    revalidatePath(`/promotions/${promoId}/voyages`);
    revalidatePath(`/promotions/${promoId}`);
    return { ok: true, data: { removed: removed.length } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setVoyageOverride(
  promoId: string,
  voyageId: string,
  overrideOfferValue: string | null
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    await db
      .update(promoVoyages)
      .set({ overrideOfferValue: overrideOfferValue || null })
      .where(
        and(
          eq(promoVoyages.promoId, promoId),
          eq(promoVoyages.voyageId, voyageId)
        )
      );
    await logActivity({
      entityType: "promotion",
      entityId: promoId,
      action: "voyage_override_set",
      changes: {
        override: { old: null, new: overrideOfferValue },
        voyage_id: { old: null, new: voyageId },
      },
      performedBy: profile.id,
    });
    revalidatePath(`/promotions/${promoId}/voyages`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

// ---------------------------------------------------------------------------
// Disclaimer + audience linking
// ---------------------------------------------------------------------------
export async function setPromoDisclaimers(
  promoId: string,
  disclaimerIds: string[]
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    await db.delete(promoDisclaimers).where(eq(promoDisclaimers.promoId, promoId));
    if (disclaimerIds.length > 0) {
      await db
        .insert(promoDisclaimers)
        .values(disclaimerIds.map((disclaimerId) => ({ promoId, disclaimerId })))
        .onConflictDoNothing();
    }
    await logActivity({
      entityType: "promotion",
      entityId: promoId,
      action: "disclaimers_updated",
      changes: { disclaimer_count: { old: null, new: disclaimerIds.length } },
      performedBy: profile.id,
    });
    revalidatePath(`/promotions/${promoId}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setPromoAudiences(
  promoId: string,
  segmentIds: string[]
): Promise<ActionResult> {
  try {
    const profile = await requirePermission("canCreate");
    await db.delete(promoAudiences).where(eq(promoAudiences.promoId, promoId));
    if (segmentIds.length > 0) {
      await db
        .insert(promoAudiences)
        .values(segmentIds.map((segmentId) => ({ promoId, segmentId })))
        .onConflictDoNothing();
    }
    await logActivity({
      entityType: "promotion",
      entityId: promoId,
      action: "audiences_updated",
      changes: { audience_count: { old: null, new: segmentIds.length } },
      performedBy: profile.id,
    });
    revalidatePath(`/promotions/${promoId}`);
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}
