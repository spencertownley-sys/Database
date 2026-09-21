"use client";

import { useState } from "react";
import { WeeklyGrid } from "@/components/availability/WeeklyGrid";
import { ExceptionsEditor } from "@/components/availability/ExceptionsEditor";
import { setExceptionStatus, setWeeklyStatus, removeException } from "@/app/actions/availability";
import { useToast } from "@/components/ui/use-toast";
import type { AvailabilityStatus, MemberWithAvailability } from "@/types";

export function AvailabilityEditor({
  slug,
  token,
  member,
}: {
  slug: string;
  token: string;
  member: MemberWithAvailability;
}) {
  const { toast } = useToast();
  const [exceptions, setExceptions] = useState(member.exceptions);

  async function handleCellChange(dayOfWeek: number, timeBlock: string, status: AvailabilityStatus) {
    const result = await setWeeklyStatus(slug, token, dayOfWeek, timeBlock, status);
    if (!result.ok) {
      toast({ title: "Couldn't save that", description: result.error, variant: "destructive" });
    }
  }

  async function handleSaveException(date: string, status: AvailabilityStatus, note?: string) {
    const result = await setExceptionStatus(slug, token, date, status, note);
    if (!result.ok) {
      toast({ title: "Couldn't save that", description: result.error, variant: "destructive" });
      return;
    }
    setExceptions((prev) => {
      const withoutDate = prev.filter((e) => e.date !== date);
      return [
        ...withoutDate,
        {
          id: `${date}-local`,
          memberId: member.id,
          date,
          status,
          note: note?.trim() || null,
          createdAt: new Date(),
        },
      ].sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  async function handleRemoveException(date: string) {
    const result = await removeException(slug, token, date);
    if (!result.ok) {
      toast({ title: "Couldn't remove that", description: result.error, variant: "destructive" });
      return;
    }
    setExceptions((prev) => prev.filter((e) => e.date !== date));
  }

  return (
    <div className="mt-8 space-y-10">
      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="mb-4 font-semibold">Your typical week</h2>
        <WeeklyGrid grid={member.weeklyGrid} onCellChange={handleCellChange} />
      </section>

      <section className="rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="mb-1 font-semibold">Exceptions to your usual week</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Busy on a date you&apos;re normally free? Or free on one you&apos;re not? Add it here.
        </p>
        <ExceptionsEditor
          exceptions={exceptions}
          onSave={handleSaveException}
          onRemove={handleRemoveException}
        />
      </section>
    </div>
  );
}
