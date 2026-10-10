import { notFound } from "next/navigation";
import { getBandBySlug } from "@/db/queries/bands";
import { JoinForm } from "@/components/join/JoinForm";
import { Logo } from "@/components/brand/Logo";
import { describeEvent } from "@/lib/band-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const band = await getBandBySlug(slug);
  if (!band) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-6">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{band.name}</CardTitle>
          {describeEvent(band) && (
            <p className="text-sm font-medium text-primary">{describeEvent(band)}</p>
          )}
          <CardDescription>What&apos;s your name? We&apos;ll remember you next time.</CardDescription>
        </CardHeader>
        <CardContent>
          <JoinForm slug={slug} />
        </CardContent>
      </Card>
    </div>
  );
}
