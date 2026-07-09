import { Suspense } from "react";
import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { VoyageCatalog } from "@/components/voyages/VoyageCatalog";
import { listVoyages, listShips, listRegions } from "@/db/queries/voyages";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Voyages" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | undefined>;
}

async function VoyagesContent({ searchParams }: PageProps) {
  const [rows, ships, regions] = await Promise.all([
    listVoyages({
      shipId: searchParams.ship,
      regionId: searchParams.region,
      from: searchParams.from,
      to: searchParams.to,
      duration: searchParams.duration ? Number(searchParams.duration) : undefined,
      status: searchParams.status,
      minOccupancy: searchParams.minOcc ? Number(searchParams.minOcc) : undefined,
      maxOccupancy: searchParams.maxOcc ? Number(searchParams.maxOcc) : undefined,
      noActivePromo: searchParams.noPromo === "1",
      q: searchParams.q,
      limit: 600,
    }),
    listShips(),
    listRegions(),
  ]);

  return (
    <VoyageCatalog
      rows={rows.map((r) => ({
        voyage: r.voyage,
        shipName: r.shipName,
        regionName: r.regionName,
        activePromoCount: r.activePromoCount,
      }))}
      ships={ships.map((s) => ({ id: s.ship.id, name: s.ship.name }))}
      regions={regions.map((r) => ({ id: r.id, name: r.name }))}
    />
  );
}

export default function VoyagesPage({ searchParams }: PageProps) {
  return (
    <PageShell
      title="Voyage catalog"
      description="Every sailing across the fleet — the product catalog promotions attach to."
    >
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-full max-w-2xl" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <VoyagesContent searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}
