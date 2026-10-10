import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getBandSettingsForLeader } from "@/db/queries/bands";
import { BandForm } from "@/components/dashboard/BandForm";
import type { BandSettingsInput } from "@/app/actions/bands";
import type { ScheduleType, LocationType } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function EditBandPage({ params }: { params: { bandId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/dashboard/bands/${params.bandId}/edit`);

  const band = await getBandSettingsForLeader(params.bandId, profile.id);
  if (!band) notFound();

  const initialValues: BandSettingsInput = {
    name: band.name,
    description: band.description ?? "",
    scheduleType: band.scheduleType as ScheduleType,
    startDate: band.startDate,
    endDate: band.endDate,
    activeDays: band.activeDays ?? [0, 1, 2, 3, 4, 5, 6],
    timeSlotStart: band.timeSlotStart,
    timeSlotEnd: band.timeSlotEnd,
    timeSlotMinutes: band.timeSlotMinutes,
    eventDurationMinutes: band.eventDurationMinutes,
    location: band.location ?? "",
    locationType: band.locationType as LocationType,
    timezone: band.timezone,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Edit {band.name}</h1>
      <p className="mt-1 text-muted-foreground">Update the details of your event.</p>
      <div className="mt-8">
        <BandForm mode="edit" bandId={band.id} initialValues={initialValues} />
      </div>
    </div>
  );
}
