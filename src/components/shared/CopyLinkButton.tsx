"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy } from "lucide-react";

/** A read-only, copyable input for any app-relative path (e.g. /join/slug or /a/slug/token). */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(path);

  function handleFocus() {
    if (typeof window !== "undefined") {
      setUrl(`${window.location.origin}${path}`);
    }
  }

  async function handleCopy() {
    const full = typeof window !== "undefined" ? `${window.location.origin}${path}` : url;
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
