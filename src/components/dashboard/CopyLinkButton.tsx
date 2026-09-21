"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy } from "lucide-react";

export function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(`/join/${slug}`);

  function handleFocus() {
    if (typeof window !== "undefined") {
      setUrl(`${window.location.origin}/join/${slug}`);
    }
  }

  async function handleCopy() {
    const full = typeof window !== "undefined" ? `${window.location.origin}/join/${slug}` : url;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the input is still selectable/copyable.
    }
  }

  return (
    <div className="flex gap-2">
      <Input readOnly value={url} onFocus={handleFocus} onClick={(e) => e.currentTarget.select()} />
      <Button type="button" onClick={handleCopy} variant="outline">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
