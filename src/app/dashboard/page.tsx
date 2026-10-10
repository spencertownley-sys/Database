import Link from "next/link";
import { getCurrentProfile } from "@/lib/supabase/server";
import { listBandsForLeader, listBandsForMemberProfile } from "@/db/queries/bands";
import { describeSchedule } from "@/lib/band-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Users } from "lucide-react";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const bands = profile ? await listBandsForLeader(profile.id) : [];
  const memberships = profile ? await listBandsForMemberProfile(profile.id) : [];

  return (
    <div className="space-y-10">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Your events</h1>
            <p className="mt-1 text-muted-foreground">
              Set up an event, share its link, and see everyone&apos;s availability in one place.
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/bands/new">
              <Plus className="h-4 w-4" />
              New event
            </Link>
          </Button>
        </div>

        {bands.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed p-12 text-center">
            <p className="font-medium">No events yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first event to get a shareable availability link.
            </p>
            <div className="mt-4 flex justify-center">
              <Button asChild>
                <Link href="/dashboard/bands/new">
                  <Plus className="h-4 w-4" />
                  New event
                </Link>
              </Button>
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
                  <CardContent className="space-y-1">
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      {band.memberCount} member{band.memberCount === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-muted-foreground">{describeSchedule(band)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {memberships.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Events you&apos;re in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Events where you&apos;ve linked your availability to this account.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {memberships.map(({ member, band }) => (
              <Link key={member.id} href={`/a/${band.slug}/${member.memberToken}`}>
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="text-lg">{band.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{describeSchedule(band)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
