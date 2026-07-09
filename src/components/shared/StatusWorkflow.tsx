"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { changePromoStatus } from "@/app/actions/promotions";
import {
  PROMO_STATUSES,
  PROMO_STATUS_LABELS,
  PROMO_STATUS_COLORS,
  STATUS_TRANSITIONS,
  APPROVAL_REQUIRED_STATUSES,
  type PromoStatus,
} from "@/lib/constants";

// The main pipeline shown in the stepper (terminal/exception states shown as badges)
const PIPELINE: PromoStatus[] = [
  "draft",
  "pending_rm_data",
  "pending_voyage_list",
  "pending_legal",
  "pending_approval",
  "approved",
  "live",
  "expired",
];

interface StatusWorkflowProps {
  promoId: string;
  status: string;
  canApprove: boolean;
  canEdit: boolean;
  /** Warnings shown in the confirm dialog, e.g. "No disclaimer linked". */
  warnings?: string[];
}

export function StatusWorkflow({
  promoId,
  status,
  canApprove,
  canEdit,
  warnings = [],
}: StatusWorkflowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [target, setTarget] = useState<PromoStatus | null>(null);
  const [isPending, startTransition] = useTransition();
  // Optimistic status so the stepper responds immediately.
  const [optimistic, setOptimistic] = useState<PromoStatus | null>(null);

  const current = (optimistic ?? status) as PromoStatus;
  const currentIdx = PIPELINE.indexOf(current);
  const allowed = (STATUS_TRANSITIONS[current] ?? []).filter(
    (s) => canApprove || !APPROVAL_REQUIRED_STATUSES.includes(s)
  );

  function confirm() {
    if (!target) return;
    const prev = current;
    setOptimistic(target);
    setTarget(null);
    startTransition(async () => {
      const result = await changePromoStatus(promoId, target);
      if (result.ok) {
        toast({
          title: "Status updated",
          description: `Moved to ${PROMO_STATUS_LABELS[target]}.`,
        });
        router.refresh();
      } else {
        setOptimistic(prev);
        toast({
          title: "Status change blocked",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <ol className="flex flex-wrap items-center gap-0.5 overflow-x-auto">
        {PIPELINE.map((s, i) => {
          const isDone = currentIdx > i && currentIdx !== -1;
          const isCurrent = current === s;
          return (
            <li key={s} className="flex items-center">
              {i > 0 && <span className="mx-1 h-px w-3 bg-border md:w-4" />}
              <span
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  isCurrent
                    ? PROMO_STATUS_COLORS[s].badge
                    : isDone
                      ? "border-transparent text-muted-foreground"
                      : "border-transparent text-muted-foreground/50"
                )}
              >
                {isDone && <Check className="h-3 w-3" />}
                {isCurrent && (
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", PROMO_STATUS_COLORS[s].dot)}
                  />
                )}
                {PROMO_STATUS_LABELS[s]}
              </span>
            </li>
          );
        })}
        {(current === "paused" || current === "cancelled") && (
          <li className="ml-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                PROMO_STATUS_COLORS[current].badge
              )}
            >
              {PROMO_STATUS_LABELS[current]}
            </span>
          </li>
        )}
      </ol>

      {canEdit && allowed.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={isPending}>
              {isPending ? "Updating…" : "Change status"}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">
              Move from {PROMO_STATUS_LABELS[current]}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {allowed.map((s) => (
              <DropdownMenuItem key={s} onClick={() => setTarget(s)}>
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", PROMO_STATUS_COLORS[s].dot)}
                />
                {PROMO_STATUS_LABELS[s]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm status change</DialogTitle>
            <DialogDescription>
              Move this promotion from{" "}
              <strong>{PROMO_STATUS_LABELS[current]}</strong> to{" "}
              <strong>{target ? PROMO_STATUS_LABELS[target] : ""}</strong>?
            </DialogDescription>
          </DialogHeader>
          {target === "pending_approval" && warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <p className="font-medium">Heads up before requesting approval:</p>
              <ul className="mt-1 list-inside list-disc">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={confirm}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { PROMO_STATUSES };
