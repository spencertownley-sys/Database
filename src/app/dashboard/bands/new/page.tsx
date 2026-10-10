import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/supabase/server";
import { BandForm } from "@/components/dashboard/BandForm";

export const dynamic = "force-dynamic";

export default async function NewBandPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard/bands/new");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">New event</h1>
      <p className="mt-1 text-muted-foreground">
        Set up the dates, times, and location — you can change any of this later.
      </p>
      <div className="mt-8">
        <BandForm mode="create" />
      </div>
    </div>
  );
}
