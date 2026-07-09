"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  PROMO_STATUS_COLORS,
  PROMO_STATUS_LABELS,
  PROMO_STATUSES,
} from "@/lib/constants";

interface PromosByStatusChartProps {
  data: { status: string; count: number }[];
}

export function PromosByStatusChart({ data }: PromosByStatusChartProps) {
  // Fixed status order so colors follow the entity, not the rank.
  const ordered = PROMO_STATUSES.map((s) => ({
    status: s,
    label: PROMO_STATUS_LABELS[s],
    count: data.find((d) => d.status === s)?.count ?? 0,
    color: PROMO_STATUS_COLORS[s].hex,
  })).filter((d) => d.count > 0);

  const total = ordered.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={ordered}
              dataKey="count"
              nameKey="label"
              innerRadius={52}
              outerRadius={80}
              paddingAngle={2}
              strokeWidth={0}
            >
              {ordered.map((d) => (
                <Cell key={d.status} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                color: "hsl(var(--popover-foreground))",
              }}
              formatter={(value, name) => [`${value ?? 0} promos`, String(name ?? "")]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>
      <ul className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {ordered.map((d) => (
          <li key={d.status} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: d.color }} />
              {d.label}
            </span>
            <span className="font-medium tabular-nums">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
