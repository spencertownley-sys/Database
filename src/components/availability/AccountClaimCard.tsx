"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimMemberRow } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export function AccountClaimCard({
  slug,
  token,
  isLinked,
  isLoggedIn,
  supabaseConfigured,
}: {
  slug: string;
  token: string;
  isLinked: boolean;
  isLoggedIn: boolean;
  supabaseConfigured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!supabaseConfigured) return null;

  if (isLinked) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        Linked to your account — you can find this event from your dashboard too.
      </div>
    );
  }

  function handleClaim() {
    setError(null);
    if (!isLoggedIn) {
      const next = `/a/${slug}/${token}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    startTransition(async () => {
      const result = await claimMemberRow(slug, token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-1 text-sm font-medium">Save this to your account</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Link this event to your Downbeat account so it shows up on your dashboard automatically.
      </p>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <Button type="button" size="sm" variant="outline" onClick={handleClaim} disabled={pending}>
        {pending ? "Linking…" : isLoggedIn ? "Save to my account" : "Sign in to save"}
      </Button>
    </div>
  );
}
