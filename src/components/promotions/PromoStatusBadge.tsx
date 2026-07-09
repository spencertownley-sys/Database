import { cn } from "@/lib/utils";
import {
  PROMO_STATUS_COLORS,
  PROMO_STATUS_LABELS,
  type PromoStatus,
} from "@/lib/constants";

export function PromoStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const s = (status in PROMO_STATUS_LABELS ? status : "draft") as PromoStatus;
  const colors = PROMO_STATUS_COLORS[s];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        colors.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
      {PROMO_STATUS_LABELS[s]}
    </span>
  );
}
