"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { bulkChangePromoStatus } from "@/app/actions/promotions";
import {
  PROMO_STATUSES,
  PROMO_STATUS_LABELS,
  APPROVAL_REQUIRED_STATUSES,
  type PromoStatus,
} from "@/lib/constants";

interface BulkActionsProps {
  selectedIds: string[];
  canApprove: boolean;
}

export function BulkActions({ selectedIds, canApprove }: BulkActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendingStatus, setPendingStatus] = useState<PromoStatus | null>(null);
  const [isPending, startTransition] = useTransition();

  const statuses = PROMO_STATUSES.filter(
    (s) => canApprove || !APPROVAL_REQUIRED_STATUSES.includes(s)
  );

  function apply() {
    if (!pendingStatus) return;
    startTransition(async () => {
      const result = await bulkChangePromoStatus(selectedIds, pendingStatus);
      setPendingStatus(null);
      if (result.ok && result.data) {
        toast({
          title: `Status updated`,
          description: `${result.data.updated} promotion(s) moved to ${PROMO_STATUS_LABELS[pendingStatus]}${
            result.data.skipped > 0
              ? `; ${result.data.skipped} skipped (invalid transition or missing requirements)`
              : ""
          }.`,
        });
        router.refresh();
      } else if (!result.ok) {
        toast({ title: "Bulk update failed", description: result.error, variant: "destructive" });
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-accent/50 px-3 py-2">
      <span className="text-sm font-medium">
        {selectedIds.length} selected
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Change status
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {statuses.map((s) => (
            <DropdownMenuItem key={s} onClick={() => setPendingStatus(s)}>
              {PROMO_STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!pendingStatus} onOpenChange={(o) => !o && setPendingStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm bulk status change</DialogTitle>
            <DialogDescription>
              Move {selectedIds.length} promotion(s) to{" "}
              <strong>{pendingStatus ? PROMO_STATUS_LABELS[pendingStatus] : ""}</strong>?
              Promotions with invalid transitions will be skipped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatus(null)}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={isPending}>
              {isPending ? "Updating…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
