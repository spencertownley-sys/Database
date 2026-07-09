"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { updateVoyageMetadata } from "@/app/actions/catalog";
import type { VoyageMetadata } from "@/types";

interface VoyageAttributeEditorProps {
  voyageId: string;
  metadata: VoyageMetadata;
  canEdit: boolean;
}

/** Structured editor over the voyage metadata JSONB (PIM attributes). */
export function VoyageAttributeEditor({
  voyageId,
  metadata,
  canEdit,
}: VoyageAttributeEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [entries, setEntries] = useState<[string, string][]>(() =>
    Object.entries(metadata).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.join(", ") : String(v ?? ""),
    ])
  );
  const [dirty, setDirty] = useState(false);

  function updateEntry(index: number, key: string, value: string) {
    setEntries((prev) => {
      const next = [...prev];
      next[index] = [key, value];
      return next;
    });
    setDirty(true);
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addEntry() {
    setEntries((prev) => [...prev, ["", ""]]);
    setDirty(true);
  }

  function save() {
    const next: VoyageMetadata = {};
    for (const [key, value] of entries) {
      const k = key.trim();
      if (!k) continue;
      // Comma-separated values become arrays (special_events, onboard_features…)
      next[k] = value.includes(",")
        ? value.split(",").map((s) => s.trim()).filter(Boolean)
        : value;
    }
    startTransition(async () => {
      const result = await updateVoyageMetadata(voyageId, next);
      if (result.ok) {
        toast({ title: "Attributes saved" });
        setDirty(false);
        router.refresh();
      } else {
        toast({ title: "Save failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px]">PIM attributes</CardTitle>
        <CardDescription>
          Flexible product attributes: theme, special events, onboard features.
          Comma-separate multiple values.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No attributes set.</p>
        )}
        {entries.map(([key, value], i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="attribute"
              value={key}
              disabled={!canEdit}
              onChange={(e) => updateEntry(i, e.target.value, value)}
              className="h-8 w-32 text-xs"
            />
            <Input
              placeholder="value"
              value={value}
              disabled={!canEdit}
              onChange={(e) => updateEntry(i, key, e.target.value)}
              className="h-8 flex-1 text-xs"
            />
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeEntry(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={addEntry}>
              <Plus className="h-3.5 w-3.5" />
              Add attribute
            </Button>
            {dirty && (
              <Button size="sm" onClick={save} disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
