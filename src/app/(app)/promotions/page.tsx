import { Suspense } from "react";
import type { Metadata } from "next";
import {
  listPromotions,
  listOwners,
  listPromoTags,
} from "@/db/queries/promotions";
import { listShips, listRegions } from "@/db/queries/voyages";
import { getCurrentProfile } from "@/lib/supabase/server";
import { PageShell } from "@/components/layout/PageShell";
import { PromoListClient } from "@/components/promotions/PromoListClient";
import { Skeleton } from "@/components/ui/skeleton";
import { USER_ROLES, type UserRole } from "@/lib/constants";

export const metadata: Metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | undefined>;
}

async function PromotionsContent({ searchParams }: PageProps) {
  const [rows, owners, tags, ships, regions, profile] = await Promise.all([
    listPromotions({
      status: searchParams.status,
      offerType: searchParams.offerType,
      ownerId: searchParams.owner,
      sellFrom: searchParams.sellFrom,
      sellTo: searchParams.sellTo,
      sailFrom: searchParams.sailFrom,
      sailTo: searchParams.sailTo,
      regionId: searchParams.region,
      shipId: searchParams.ship,
      tag: searchParams.tag,
      q: searchParams.q,
    }),
    listOwners(),
    listPromoTags(),
    listShips(),
    listRegions(),
    getCurrentProfile(),
  ]);

  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;

  return (
    <PromoListClient
      rows={rows}
      owners={owners}
      tags={tags}
      ships={ships.map((s) => ({ id: s.ship.id, name: s.ship.name }))}
      regions={regions.map((r) => ({ id: r.id, name: r.name }))}
      canCreate={USER_ROLES[role].canCreate}
      canApprove={USER_ROLES[role].canApprove}
    />
  );
}

export default function PromotionsPage({ searchParams }: PageProps) {
  return (
    <PageShell
      title="Promotions"
      description="Create, manage, and track every promotion across the fleet."
    >
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-full max-w-2xl" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <PromotionsContent searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}
