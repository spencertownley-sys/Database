"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
  createDisclaimer,
  updateDisclaimer,
  changeDisclaimerStatus,
} from "@/app/actions/catalog";
import { OFFER_TYPES, OFFER_TYPE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PromoStatusBadge } from "@/components/promotions/PromoStatusBadge";
import type { DisclaimerRow } from "./DisclaimerLibrary";

interface UsingPromo {
  id: string;
  promoName: string;
  status: string;
  sellStartDate: string;
  sellEndDate: string;
}

interface DisclaimerEditorProps {
  row: DisclaimerRow | null;
  creating: boolean;
  canEdit: boolean;
  canApprove: boolean;
  onDone: () => void;
}

export function DisclaimerEditor({
  row,
  creating,
  canEdit,
  canApprove,
  onDone,
}: DisclaimerEditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const d = row?.disclaimer ?? null;
  const [name, setName] = useState(d?.name ?? "");
  const [text, setText] = useState(d?.disclaimerText ?? "");
  const [offerTypes, setOfferTypes] = useState<string[]>(
    d?.appliesToOfferTypes ?? []
  );
  const [effectiveDate, setEffectiveDate] = useState(d?.effectiveDate ?? "");
  const [usingPromos, setUsingPromos] = useState<UsingPromo[]>([]);

  useEffect(() => {
    if (!d?.id) {
      setUsingPromos([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/disclaimers/${d.id}/promos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled) setUsingPromos(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [d?.id]);

  if (!creating && !d) {
    return (
      <Card className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select a disclaimer version to view or edit it.
        </p>
      </Card>
    );
  }

  const isDraft = creating || d?.status === "draft";

  function save() {
    startTransition(async () => {
      if (creating) {
        const result = await createDisclaimer({
          name,
          disclaimerText: text,
          appliesToOfferTypes: offerTypes,
          effectiveDate: effectiveDate || null,
        });
        if (result.ok) {
          toast({ title: "Disclaimer created", description: `${name} (new version)` });
          onDone();
          router.refresh();
        } else {
          toast({ title: "Create failed", description: result.error, variant: "destructive" });
        }
      } else if (d) {
        const result = await updateDisclaimer(d.id, {
          disclaimerText: text,
          appliesToOfferTypes: offerTypes,
          effectiveDate: effectiveDate || null,
        });
        if (result.ok) {
          toast({ title: "Disclaimer saved" });
          router.refresh();
        } else {
          toast({ title: "Save failed", description: result.error, variant: "destructive" });
        }
      }
    });
  }

  function setStatus(status: "draft" | "approved" | "retired") {
    if (!d) return;
    startTransition(async () => {
      const result = await changeDisclaimerStatus(d.id, status);
      if (result.ok) {
        toast({ title: `Disclaimer ${status}` });
        router.refresh();
      } else {
        toast({ title: "Status change failed", description: result.error, variant: "destructive" });
      }
    });
  }

  function newVersion() {
    if (!d) return;
    startTransition(async () => {
      const result = await createDisclaimer({
        name: d.name,
        disclaimerText: text,
        appliesToOfferTypes: offerTypes,
        effectiveDate: null,
      });
      if (result.ok) {
        toast({
          title: "New version created",
          description: `${d.name} — draft v${d.version + 1}+ created; the old version is preserved.`,
        });
        router.refresh();
      } else {
        toast({ title: "Version failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[15px]">
              {creating ? "New disclaimer" : `${d!.name} · v${d!.version}`}
            </CardTitle>
            {!creating && d && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">{d.status}</Badge>
                {canApprove && d.status === "draft" && (
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => setStatus("approved")}>
                    Approve
                  </Button>
                )}
                {canEdit && d.status === "approved" && (
                  <>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={newVersion}>
                      New version
                    </Button>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus("retired")}>
                      Retire
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          {!creating && d?.legalApprovedBy && (
            <CardDescription>
              Legal approved by {d.legalApprovedBy}
              {d.legalApprovedAt ? ` on ${formatDate(d.legalApprovedAt)}` : ""}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {creating && (
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Onboard Credit Terms"
              />
              <p className="text-xs text-muted-foreground">
                Reusing an existing name creates the next version of that disclaimer.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Disclaimer text</Label>
            <Textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canEdit || (!creating && !isDraft)}
              className="leading-relaxed"
            />
            {!creating && !isDraft && (
              <p className="text-xs text-muted-foreground">
                Approved versions are immutable — create a new version to change the language.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Applies to offer types</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {OFFER_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={offerTypes.includes(t)}
                    disabled={!canEdit || (!creating && !isDraft)}
                    onCheckedChange={(c) =>
                      setOfferTypes((prev) =>
                        c ? [...prev, t] : prev.filter((x) => x !== t)
                      )
                    }
                  />
                  {OFFER_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Effective date</Label>
            <Input
              type="date"
              className="w-44"
              value={effectiveDate ?? ""}
              disabled={!canEdit || (!creating && !isDraft)}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          {canEdit && (creating || isDraft) && (
            <div className="flex justify-end gap-2">
              {creating && (
                <Button variant="outline" onClick={onDone}>
                  Cancel
                </Button>
              )}
              <Button onClick={save} disabled={isPending || !text.trim() || (creating && !name.trim())}>
                {isPending ? "Saving…" : creating ? "Create draft" : "Save draft"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!creating && d && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px]">
              Promotions using this version
              <Badge variant="secondary" className="ml-2">{usingPromos.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {usingPromos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No promotions are linked to this version.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {usingPromos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link
                      href={`/promotions/${p.id}`}
                      className="truncate font-medium hover:text-primary hover:underline"
                    >
                      {p.promoName}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {formatDate(p.sellStartDate)} – {formatDate(p.sellEndDate)}
                      <PromoStatusBadge status={p.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
