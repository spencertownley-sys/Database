"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { updateShip } from "@/app/actions/catalog";
import { SHIP_STATUSES } from "@/lib/constants";
import type { Ship } from "@/types";

export function ShipEditor({ ship }: { ship: Ship }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [homePort, setHomePort] = useState(ship.homePort ?? "");
  const [status, setStatus] = useState(ship.status);
  const [attrs, setAttrs] = useState<[string, string][]>(() =>
    Object.entries((ship.metadata ?? {}) as Record<string, unknown>).map(
      ([k, v]) => [k, String(v ?? "")]
    )
  );

  function save() {
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of attrs) {
      if (k.trim()) metadata[k.trim()] = v;
    }
    startTransition(async () => {
      const result = await updateShip(ship.id, { homePort, status, metadata });
      if (result.ok) {
        toast({ title: "Ship updated", description: ship.name });
        setOpen(false);
        router.refresh();
      } else {
        toast({ title: "Update failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit {ship.name}</DialogTitle>
            <DialogDescription>
              Update deployment details and PIM attributes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Home port</Label>
              <Input value={homePort} onChange={(e) => setHomePort(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Attributes</Label>
              {attrs.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={k}
                    placeholder="attribute"
                    className="h-8 w-40 text-xs"
                    onChange={(e) =>
                      setAttrs((prev) => prev.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))
                    }
                  />
                  <Input
                    value={v}
                    placeholder="value"
                    className="h-8 flex-1 text-xs"
                    onChange={(e) =>
                      setAttrs((prev) => prev.map((p, j) => (j === i ? [p[0], e.target.value] : p)))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setAttrs((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAttrs((prev) => [...prev, ["", ""]])}
              >
                <Plus className="h-3.5 w-3.5" />
                Add attribute
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
