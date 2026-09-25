"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy } from "lucide-react";

/** Bookmarkable personal link + a little welcome-back messaging. */
export function PersonalLinkCard({ slug, token }: { slug: string; token: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(`/a/${slug}/${token}`);

  function handleFocus() {
    if (typeof window !== "undefined") setUrl(`${window.location.origin}/a/${slug}/${token}`);
  }

  async function handleCopy() {
    const full = typeof window !== "undefined" ? `${window.location.origin}/a/${slug}/${token}` : url;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the input is still selectable/copyable.
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-sm font-medium">Your personal link</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Bookmark this — it always brings you straight back to your availability, no sign-in needed.
      </p>
      <div className="flex gap-2">
        <Input readOnly value={url} onFocus={handleFocus} onClick={(e) => e.currentTarget.select()} />
        <Button type="button" onClick={handleCopy} variant="outline">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
