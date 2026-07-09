import type { Metadata } from "next";
import { addMonths, format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter } from "date-fns";
import { PageShell } from "@/components/layout/PageShell";
import { PromoCalendar } from "@/components/calendar/PromoCalendar";
import { calendarPromos } from "@/db/queries/calendar";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const mode = searchParams.mode === "quarter" ? "quarter" : "month";
  const anchor = searchParams.anchor
    ? new Date(searchParams.anchor + "T00:00:00")
    : new Date();

  const from =
    mode === "quarter" ? startOfQuarter(anchor) : startOfMonth(anchor);
  const to =
    mode === "quarter"
      ? endOfQuarter(anchor)
      : endOfMonth(addMonths(anchor, 0));

  const promos = await calendarPromos(
    format(from, "yyyy-MM-dd"),
    format(to, "yyyy-MM-dd")
  );

  return (
    <PageShell
      title="Promotion calendar"
      description="Sell windows across the fleet, grouped into swim lanes."
    >
      <PromoCalendar
        promos={promos}
        from={format(from, "yyyy-MM-dd")}
        to={format(to, "yyyy-MM-dd")}
        mode={mode}
        anchor={format(anchor, "yyyy-MM-dd")}
      />
    </PageShell>
  );
}
