"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Users, ScrollText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/components/ui/use-toast";
import {
  setPromoDisclaimers,
  setPromoAudiences,
} from "@/app/actions/promotions";
import { formatNumber, cn } from "@/lib/utils";
import type { Disclaimer, AudienceSegment } from "@/types";

// ---------------------------------------------------------------------------
// Disclaimer linking with inline preview
// ---------------------------------------------------------------------------
export function DisclaimerLinkPanel({
  promoId,
  linked,
  library,
  canEdit,
}: {
  promoId: string;
  linked: Disclaimer[];
  library: Disclaimer[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(
    linked[0]?.id ?? null
  );
  const linkedIds = useMemo(() => new Set(linked.map((d) => d.id)), [linked]);
  const preview =
    linked.find((d) => d.id === previewId) ?? linked[0] ?? null;

  function toggle(disclaimerId: string) {
    const next = linkedIds.has(disclaimerId)
      ? linked.filter((d) => d.id !== disclaimerId).map((d) => d.id)
      : [...linked.map((d) => d.id), disclaimerId];
    startTransition(async () => {
      const result = await setPromoDisclaimers(promoId, next);
      if (result.ok) router.refresh();
      else
        toast({
          title: "Could not update disclaimers",
          description: result.error,
          variant: "destructive",
        });
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          Disclaimers
          <Badge variant="secondary">{linked.length}</Badge>
        </CardTitle>
        {linked.length === 0 && (
          <CardDescription className="text-amber-600 dark:text-amber-400">
            No disclaimer linked — required before this promo can go live.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={isPending} className="w-full justify-between">
                Select from disclaimer library…
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search disclaimers…" />
                <CommandList>
                  <CommandEmpty>No disclaimers found.</CommandEmpty>
                  <CommandGroup>
                    {library.map((d) => (
                      <CommandItem
                        key={d.id}
                        value={`${d.name} v${d.version}`}
                        onSelect={() => toggle(d.id)}
                      >
                        <Check
                          className={cn(
                            "h-4 w-4",
                            linkedIds.has(d.id) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">
                            {d.name}{" "}
                            <span className="text-muted-foreground">v{d.version}</span>
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {d.status} · {(d.appliesToOfferTypes ?? []).join(", ") || "all offer types"}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        {linked.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {linked.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setPreviewId(d.id)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                    preview?.id === d.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  <Eye className="h-3 w-3" />
                  {d.name} v{d.version}
                </button>
              ))}
            </div>
            {preview && (
              <blockquote className="rounded-md border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                {preview.disclaimerText}
              </blockquote>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audience linking with estimated reach
// ---------------------------------------------------------------------------
export function AudienceLinkPanel({
  promoId,
  linked,
  segments,
  canEdit,
}: {
  promoId: string;
  linked: AudienceSegment[];
  segments: AudienceSegment[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const linkedIds = useMemo(() => new Set(linked.map((s) => s.id)), [linked]);
  const totalReach = linked.reduce((sum, s) => sum + (s.estimatedSize ?? 0), 0);

  function toggle(segmentId: string) {
    const next = linkedIds.has(segmentId)
      ? linked.filter((s) => s.id !== segmentId).map((s) => s.id)
      : [...linked.map((s) => s.id), segmentId];
    startTransition(async () => {
      const result = await setPromoAudiences(promoId, next);
      if (result.ok) router.refresh();
      else
        toast({
          title: "Could not update audiences",
          description: result.error,
          variant: "destructive",
        });
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Users className="h-4 w-4 text-muted-foreground" />
          Audience segments
          <Badge variant="secondary">{linked.length}</Badge>
        </CardTitle>
        <CardDescription>
          {linked.length > 0
            ? `Estimated combined reach: ${formatNumber(totalReach)} guests`
            : "No audience linked — required before this promo can go live."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {segments.map((s) => {
            const isLinked = linkedIds.has(s.id);
            return (
              <div
                key={s.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                  isLinked ? "border-primary/40 bg-primary/5" : "border-transparent"
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {s.description} · est. {formatNumber(s.estimatedSize)}
                  </span>
                </div>
                {canEdit && (
                  <Button
                    variant={isLinked ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    disabled={isPending}
                    onClick={() => toggle(s.id)}
                  >
                    {isLinked ? "Remove" : "Add"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
