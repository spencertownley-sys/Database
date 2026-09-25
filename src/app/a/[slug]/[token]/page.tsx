import Link from "next/link";
import { getMemberByToken } from "@/db/queries/members";
import { getBandBySlug } from "@/db/queries/bands";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getDateColumns, getTimeSlots, describeSchedule, describeEvent } from "@/lib/band-settings";
import { Logo } from "@/components/brand/Logo";
import { AvailabilityEditor } from "@/components/availability/AvailabilityEditor";
import { PersonalLinkCard } from "@/components/availability/PersonalLinkCard";
import { AccountClaimCard } from "@/components/availability/AccountClaimCard";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  params,
}: {
  params: { slug: string; token: string };
}) {
  const context = await getMemberByToken(params.slug, params.token);

  if (!context) {
    const band = await getBandBySlug(params.slug);
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
        <div className="mb-6">
          <Logo />
        </div>
        <h1 className="text-xl font-semibold">That link doesn&apos;t work anymore</h1>
        <p className="mt-2 max-w-sm text-muted-foreground">
          {band
            ? "Your personal link may have expired or been replaced. Rejoin to get a fresh one."
            : "This event may have been removed."}
        </p>
        {band && (
          <Button asChild className="mt-6">
            <Link href={`/join/${params.slug}`}>Rejoin {band.name}</Link>
          </Button>
        )}
      </div>
    );
  }

  const { band, member } = context;
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const profile = supabaseConfigured ? await getCurrentProfile() : null;

  const dateColumns = getDateColumns(band, band.dayLabels);
  const timeSlots = getTimeSlots(band);
  const schedule = describeSchedule(band);
  const location = describeEvent(band);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="text-right text-sm">
            <p className="font-medium">{band.name}</p>
            <p className="text-xs text-muted-foreground">Hi, {member.name}</p>
          </div>
        </div>
      </header>
      <main className="container max-w-3xl py-10">
        <h1 className="text-2xl font-bold tracking-tight">{band.name}</h1>
        {band.description && <p className="mt-1 text-muted-foreground">{band.description}</p>}
        <p className="mt-2 text-sm text-muted-foreground">
          {schedule}
          {location ? ` · ${location}` : ""}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <PersonalLinkCard slug={params.slug} token={params.token} />
          <AccountClaimCard
            slug={params.slug}
            token={params.token}
            isLinked={!!member.profileId}
            isLoggedIn={!!profile}
            supabaseConfigured={supabaseConfigured}
          />
        </div>

        <AvailabilityEditor
          slug={params.slug}
          token={params.token}
          dateColumns={dateColumns}
          timeSlots={timeSlots}
          grid={member.grid}
        />
      </main>
    </div>
  );
}
