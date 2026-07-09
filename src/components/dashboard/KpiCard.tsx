import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  href?: string;
  tone?: "default" | "warning";
  hint?: string;
}

export function KpiCard({ label, value, icon: Icon, href, tone = "default", hint }: KpiCardProps) {
  const body = (
    <Card className={cn("transition-colors", href && "hover:border-primary/40")}>
      <CardContent className="flex items-start justify-between gap-2 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {value}
          </p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tone === "warning"
              ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
              : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
