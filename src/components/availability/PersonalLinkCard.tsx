"use client";

import { useEffect } from "react";
import { CopyLinkButton } from "@/components/shared/CopyLinkButton";

export function PersonalLinkCard({
  slug,
  token,
  name,
}: {
  slug: string;
  token: string;
  name: string;
}) {
  // Keep localStorage in sync even if they landed here straight from a saved
  // or shared link rather than the join form — so /join/[slug] on this
  // device recognizes them next time too.
  useEffect(() => {
    try {
      localStorage.setItem(`downbeat:member:${slug}`, JSON.stringify({ token, name }));
    } catch {
      // localStorage unavailable — the URL itself still works fine.
    }
  }, [slug, token, name]);

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-6">
      <h2 className="mb-1 font-semibold">Your link</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Bookmark this or text it to yourself — it&apos;s the only way back in, and it always
        brings you here to update your availability.
      </p>
      <CopyLinkButton path={`/a/${slug}/${token}`} />
    </section>
  );
}
