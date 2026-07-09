import type { Metadata } from "next";
import Link from "next/link";
import { Ship as ShipIcon, Users, CalendarDays, Anchor } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShipEditor } from "@/components/voyages/ShipEditor";
import { listShips } from "@/db/queries/voyages";
import { getCurrentProfile } from "@/lib/supabase/server";
import { USER_ROLES, type UserRole } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Ships" };
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  drydock: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  retired: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default async function ShipsPage() {
  const [ships, profile] = await Promise.all([listShips(), getCurrentProfile()]);
  const role = (profile?.role && profile.role in USER_ROLES
    ? profile.role
    : "viewer") as UserRole;
  const canEdit = USER_ROLES[role].canCreate;

  return (
    <PageShell
      title="Ship catalog"
      description={`${ships.length} ships in the Celestial Cruises fleet.`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ships.map(({ ship, voyageCount }) => (
          <Card key={ship.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShipIcon className="h-4 w-4" />
                </div>
                <Badge
                  className={`border-transparent text-[10px] capitalize ${STATUS_STYLES[ship.status] ?? ""}`}
                  variant="outline"
                >
                  {ship.status}
                </Badge>
              </div>
              <CardTitle className="pt-1 text-sm">{ship.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {ship.shipClass} class · built {ship.yearBuilt}
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  <span>{formatNumber(ship.capacityGuests)} guests</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Anchor className="h-3.5 w-3.5" />
                  <span>{ship.homePort}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>{formatNumber(voyageCount)} voyages scheduled</span>
                </div>
              </dl>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <Link href={`/voyages?ship=${ship.id}`}>View voyages</Link>
                </Button>
                {canEdit && <ShipEditor ship={ship} />}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
