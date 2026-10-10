import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getBandForLeader } from "@/db/queries/bands";
import { getDateColumns, getTimeSlots, describeSchedule, describeEvent, timezoneLabel } from "@/lib/band-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AggregateDateGrid } from "@/components/availability/AggregateDateGrid";
import { StatusLegend } from "@/components/availability/StatusLegend";
import { CopyLinkButton } from "@/components/shared/CopyLinkButton";
import { DayLabelsEditor } from "@/components/dashboard/DayLabelsEditor";
import { Pencil } from "lucide-react";
import { format } from "date-fns";

export default async function BandDetailPage({ params }: { params: Promise<{ bandId: string }> }) {
  const { bandId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const band = await getBandForLeader(bandId, profile.id);
  if (!band) notFound();

  const dateColumns = getDateColumns(band, band.dayLabels);
  const timeSlots = getTimeSlots(band);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{band.name}</h1>
          {band.description && <p className="mt-1 text-muted-foreground">{band.description}</p>}
          <p className="mt-2 text-sm text-muted-foreground">
            {describeSchedule(band)} &middot; {timezoneLabel(band.timezone)}
            {describeEvent(band) ? ` · ${describeEvent(band)}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {band.members.length} member{band.members.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/bands/${band.id}/edit`}>
            <Pencil className="h-4 w-4" />
            Edit event
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite link</CardTitle>
        </CardHeader>
        <CardContent>
          <CopyLinkButton path={`/join/${band.slug}`} />
          <p className="mt-2 text-sm text-muted-foreground">
            Send this to your bandmates. They&apos;ll enter their name and mark their availability
            — no account needed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Label specific dates</CardTitle>
        </CardHeader>
        <CardContent>
          <DayLabelsEditor
            bandId={band.id}
            minDate={band.startDate}
            maxDate={band.endDate}
            dayLabels={band.dayLabels}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When the band overlaps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AggregateDateGrid
            grid={band.aggregate}
            dateColumns={dateColumns}
            timeSlots={timeSlots}
            memberCount={band.members.length}
          />
          <StatusLegend />
        </CardContent>
      </Card>

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
                  <div>
                    <span className="font-medium">{member.name}</span>
                    {member.instrument && (
                      <span className="ml-2 text-xs text-muted-foreground">{member.instrument}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Last updated {format(new Date(member.lastSeenAt ?? member.createdAt!), "MMM d")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
