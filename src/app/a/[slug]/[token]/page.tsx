import { notFound } from "next/navigation";
import { getMemberByToken } from "@/db/queries/members";
import { Logo } from "@/components/brand/Logo";
import { AvailabilityEditor } from "@/components/availability/AvailabilityEditor";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  params,
}: {
  params: { slug: string; token: string };
}) {
  const context = await getMemberByToken(params.slug, params.token);
  if (!context) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Logo />
          <div className="text-right text-sm">
            <p className="font-medium">{context.bandName}</p>
            <p className="text-xs text-muted-foreground">Hi, {context.member.name}</p>
          </div>
        </div>
      </header>
      <main className="container max-w-3xl py-10">
        <h1 className="text-2xl font-bold tracking-tight">Your availability</h1>
        <p className="mt-1 text-muted-foreground">
          Tap the squares below for how your week usually looks. Changes save automatically.
        </p>
        <AvailabilityEditor slug={params.slug} token={params.token} member={context.member} />
      </main>
    </div>
  );
}
