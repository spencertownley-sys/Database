"use client";

import { useState } from "react";
import { updateMemberProfile } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

export function ProfileEditor({
  slug,
  token,
  name: initialName,
  instrument: initialInstrument,
  contact: initialContact,
}: {
  slug: string;
  token: string;
  name: string;
  instrument: string | null;
  contact: string | null;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [instrument, setInstrument] = useState(initialInstrument ?? "");
  const [contact, setContact] = useState(initialContact ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateMemberProfile(slug, token, { name, instrument, contact });
    setSaving(false);
    if (!result.ok) {
      toast({ title: "Couldn't save that", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-instrument">Role / instrument</Label>
        <Input
          id="profile-instrument"
          value={instrument}
          onChange={(e) => setInstrument(e.target.value)}
          placeholder="Guitar, vocals, manager…"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-contact">Phone or email</Label>
        <Input
          id="profile-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save info"}
        </Button>
      </div>
    </form>
  );
}
