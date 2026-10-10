import { DateAvailabilityGrid } from "@/components/availability/DateAvailabilityGrid";
import { StatusLegend } from "@/components/availability/StatusLegend";
import type { DateColumn, MemberGrid } from "@/types";

export function AvailabilityEditor({
  slug,
  token,
  dateColumns,
  timeSlots,
  grid,
}: {
  slug: string;
  token: string;
  dateColumns: DateColumn[];
  timeSlots: string[];
  grid: MemberGrid;
}) {
  return (
    <div className="mt-8 space-y-4">
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="mb-4 font-semibold">Your availability</h2>
        <DateAvailabilityGrid
          slug={slug}
          token={token}
          dateColumns={dateColumns}
          timeSlots={timeSlots}
          initialGrid={grid}
        />
        <StatusLegend className="mt-4" />
      </section>
    </div>
  );
}
