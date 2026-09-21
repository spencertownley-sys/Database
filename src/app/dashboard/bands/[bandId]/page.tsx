import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getBandForLeader } from "@/db/queries/bands";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AggregateGrid } from "@/components/availability/AggregateGrid";
import { CopyLinkButton } from "@/components/dashboard/CopyLinkButton";
import { Legend } from "@/components/availability/WeeklyGrid";
import { STATUS_META, type AvailabilityStatus } from "@/lib/constants";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default async function BandDetailPage({ params }: { params: { bandId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const band = await getBandForLeader(params.bandId, profile.id);
  if (!band) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const upcomingExceptions = band.members
    .flatMap((m) => m.exceptions.map((e) => ({ ...e, memberName: m.name })))
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{band.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {band.members.length} member{band.members.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite link</CardTitle>
        </CardHeader>
        <CardContent>
          <CopyLinkButton slug={band.slug} />
          <p className="mt-2 text-sm text-muted-foreground">
            Send this to your bandmates. They&apos;ll enter their name and mark their availability
            — no account needed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When the band overlaps</CardTitle>
        </CardHeader>
        <CardContent>
          <AggregateGrid grid={band.aggregate} memberCount={band.members.length} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent>
            {band.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one has joined yet — share the link above.
              </p>
            ) : (
              <ul className="space-y-3">
                {band.members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between">
                    <span className="font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Last updated {format(new Date(member.lastSeenAt ?? member.createdAt!), "MMM d")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming exceptions</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingExceptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one has flagged a specific date yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {upcomingExceptions.map((ex) => (
                  <li key={ex.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        STATUS_META[ex.status as AvailabilityStatus].dotClass
                      )}
                    />
                    <span className="font-medium">{format(new Date(`${ex.date}T00:00:00`), "EEE, MMM d")}</span>
                    <span className="text-muted-foreground">
                      {ex.memberName} — {STATUS_META[ex.status as AvailabilityStatus].label}
                      {ex.note ? ` (${ex.note})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Legend />
    </div>
  );
}
