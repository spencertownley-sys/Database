import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { VoyageLinkTable } from "@/components/promotions/VoyageLinkTable";
import { Button } from "@/components/ui/button";
import { getPromotion, getLinkedVoyages } from "@/db/queries/promotions";
import { listShips, listRegions } from "@/db/queries/voyages";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";

export const metadata: Metadata = { title: "Manage Voyages" };
export const dynamic = "force-dynamic";

export default async function PromoVoyagesPage({
  params,
}: {
  params: { id: string };
}) {
  const [promo, linked, ships, regions, profile] = await Promise.all([
    getPromotion(params.id),
    getLinkedVoyages(params.id),
    listShips(),
    listRegions(),
    getCurrentProfile(),
  ]);
  if (!promo) notFound();

  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;

  return (
    <PageShell
      title={`Voyages · ${promo.promoName}`}
      description="Link sailings to this promotion. Use the filters to bulk-select matching voyages."
      actions={
        <div className="flex items-center gap-3">
          <PromoStatusBadge status={promo.status} />
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/promotions/${promo.id}`}>
              <ArrowLeft className="h-4 w-4" />
              Back to promo
            </Link>
          </Button>
        </div>
      }
    >
      <VoyageLinkTable
        promoId={promo.id}
        defaultOfferValue={promo.offerValue}
        initialLinked={linked.map((pv) => ({
          linkId: pv.id,
          voyageId: pv.voyageId,
          overrideOfferValue: pv.overrideOfferValue,
          voyageCode: pv.voyage.voyageCode,
          itineraryName: pv.voyage.itineraryName,
          sailDate: pv.voyage.sailDate,
          durationNights: pv.voyage.durationNights,
          shipName: pv.voyage.ship?.name ?? "",
          regionName: pv.voyage.region?.name ?? "",
          occupancyPercent: pv.voyage.occupancyPercent,
        }))}
        ships={ships.map((s) => ({ id: s.ship.id, name: s.ship.name }))}
        regions={regions.map((r) => ({ id: r.id, name: r.name }))}
        canEdit={USER_ROLES[role].canCreate}
      />
    </PageShell>
  );
}
