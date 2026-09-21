import { notFound } from "next/navigation";
import { getBandBySlug } from "@/db/queries/bands";
import { JoinForm } from "@/components/join/JoinForm";
import { Logo } from "@/components/brand/Logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: { slug: string } }) {
  const band = await getBandBySlug(params.slug);
  if (!band) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-6">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{band.name}</CardTitle>
          <CardDescription>What&apos;s your name? We&apos;ll remember you next time.</CardDescription>
        </CardHeader>
        <CardContent>
          <JoinForm slug={params.slug} />
        </CardContent>
      </Card>
    </div>
  );
}
