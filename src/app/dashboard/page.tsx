import Link from "next/link";
import { getCurrentProfile } from "@/lib/supabase/server";
import { listBandsForLeader } from "@/db/queries/bands";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateBandDialog } from "@/components/dashboard/CreateBandDialog";
import { Users } from "lucide-react";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const bands = profile ? await listBandsForLeader(profile.id) : [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your bands</h1>
          <p className="mt-1 text-muted-foreground">
            Create a band, share its link, and see everyone&apos;s availability in one place.
          </p>
        </div>
        <CreateBandDialog />
      </div>

      {bands.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed p-12 text-center">
          <p className="font-medium">No bands yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first band to get a shareable availability link.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateBandDialog />
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bands.map((band) => (
            <Link key={band.id} href={`/dashboard/bands/${band.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{band.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  {band.memberCount} member{band.memberCount === 1 ? "" : "s"}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
