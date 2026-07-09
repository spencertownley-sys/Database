"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { upsertAudienceSegment } from "@/app/actions/catalog";
import { formatNumber } from "@/lib/utils";
import type { AudienceSegment, AudienceCriteria } from "@/types";

interface AudienceRow {
  segment: AudienceSegment;
  activePromoCount: number;
  totalPromoCount: number;
}

interface AudienceManagerProps {
  rows: AudienceRow[];
  canEdit: boolean;
}

interface EditorState {
  id?: string;
  name: string;
  description: string;
  estimatedSize: string;
  criteria: [string, string][];
}

const EMPTY: EditorState = {
  name: "",
  description: "",
  estimatedSize: "",
  criteria: [],
};

export function AudienceManager({ rows, canEdit }: AudienceManagerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editor, setEditor] = useState<EditorState | null>(null);

  function openEdit(row?: AudienceRow) {
    if (!row) {
      setEditor(EMPTY);
      return;
    }
    setEditor({
      id: row.segment.id,
      name: row.segment.name,
      description: row.segment.description ?? "",
      estimatedSize: row.segment.estimatedSize?.toString() ?? "",
      criteria: Object.entries(
        (row.segment.criteria ?? {}) as Record<string, unknown>
      ).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]),
    });
  }

  function save() {
    if (!editor) return;
    const criteria: AudienceCriteria = {};
    for (const [k, v] of editor.criteria) {
      if (!k.trim()) continue;
      try {
        criteria[k.trim()] = JSON.parse(v);
      } catch {
        criteria[k.trim()] = v;
      }
    }
    startTransition(async () => {
      const result = await upsertAudienceSegment({
        id: editor.id,
        name: editor.name,
        description: editor.description,
        criteria,
        estimatedSize: editor.estimatedSize ? Number(editor.estimatedSize) : null,
      });
      if (result.ok) {
        toast({ title: editor.id ? "Segment updated" : "Segment created", description: editor.name });
        setEditor(null);
        router.refresh();
      } else {
        toast({ title: "Save failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => openEdit()}>
            <Plus className="h-4 w-4" />
            New segment
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.segment.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(row)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <CardTitle className="pt-1 text-sm">{row.segment.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{row.segment.description}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Estimated size</span>
                <span className="font-medium tabular-nums">
                  {formatNumber(row.segment.estimatedSize)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Used by</span>
                <span>
                  <Badge variant="secondary" className="text-[10px]">
                    {row.activePromoCount} active
                  </Badge>{" "}
                  <span className="text-muted-foreground">
                    / {row.totalPromoCount} total promos
                  </span>
                </span>
              </div>
              {Object.keys((row.segment.criteria ?? {}) as object).length > 0 && (
                <div className="rounded-md bg-muted/60 p-2 font-mono text-[10px] text-muted-foreground">
                  {JSON.stringify(row.segment.criteria)}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? "Edit segment" : "New segment"}</DialogTitle>
            <DialogDescription>
              Define who this segment targets. Criteria values may be plain text
              or JSON (arrays, numbers, objects).
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="Past Cruisers - Platinum+"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Estimated size (guests)</Label>
                <Input
                  type="number"
                  className="w-40"
                  value={editor.estimatedSize}
                  onChange={(e) => setEditor({ ...editor, estimatedSize: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Criteria</Label>
                {editor.criteria.map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={k}
                      placeholder="rule (e.g. loyalty_tier)"
                      className="h-8 w-44 text-xs"
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          criteria: editor.criteria.map((c, j) =>
                            j === i ? [e.target.value, c[1]] : c
                          ),
                        })
                      }
                    />
                    <Input
                      value={v}
                      placeholder='value (e.g. "platinum" or ["FL","TX"])'
                      className="h-8 flex-1 text-xs"
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          criteria: editor.criteria.map((c, j) =>
                            j === i ? [c[0], e.target.value] : c
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() =>
                        setEditor({
                          ...editor,
                          criteria: editor.criteria.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setEditor({ ...editor, criteria: [...editor.criteria, ["", ""]] })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add rule
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={isPending || !editor?.name.trim()}>
              {isPending ? "Saving…" : "Save segment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
