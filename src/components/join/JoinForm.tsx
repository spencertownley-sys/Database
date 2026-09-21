"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinBand } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await joinBand(slug, name);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(!result.ok ? result.error : "Something went wrong. Please try again.");
      return;
    }
    try {
      localStorage.setItem(`downbeat:member:${slug}`, result.data.token);
    } catch {
      // localStorage unavailable — the URL itself still works fine.
    }
    router.push(`/a/${slug}/${result.data.token}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "One sec…" : "Continue"}
      </Button>
    </form>
  );
}
