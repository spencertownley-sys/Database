"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { createBand, updateBandSettings } from "@/app/actions/bands";
import { validateSettings, type BandSettingsInput } from "@/lib/band-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DAYS_OF_WEEK,
  LOCATION_TYPES,
  SCHEDULE_TYPES,
  TIMEZONES,
  type LocationType,
  type ScheduleType,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

function defaultValues(): BandSettingsInput {
  const today = new Date();
  return {
    name: "",
    description: "",
    scheduleType: "date_time",
    startDate: format(today, "yyyy-MM-dd"),
    endDate: format(addDays(today, 27), "yyyy-MM-dd"),
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    timeSlotStart: "17:00",
    timeSlotEnd: "22:00",
    timeSlotMinutes: 60,
    eventDurationMinutes: 120,
    location: "",
    locationType: "tbd",
    timezone: "America/New_York",
  };
}

export function BandForm({
  mode,
  bandId,
  initialValues,
}: {
  mode: "create" | "edit";
  bandId?: string;
  initialValues?: BandSettingsInput;
}) {
  const router = useRouter();
  const [values, setValues] = useState<BandSettingsInput>(initialValues ?? defaultValues());
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof BandSettingsInput>(key: K, value: BandSettingsInput[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDay(day: number) {
    setValues((prev) => {
      const has = prev.activeDays.includes(day);
      const activeDays = has
        ? prev.activeDays.filter((d) => d !== day)
        : [...prev.activeDays, day].sort((a, b) => a - b);
      return { ...prev, activeDays };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clientErrors = validateSettings(values);
    if (clientErrors.length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors([]);
    setLoading(true);
    const result =
      mode === "create" ? await createBand(values) : await updateBandSettings(bandId!, values);
    setLoading(false);
    if (!result.ok) {
      setErrors([result.error]);
      return;
    }
    router.push(`/dashboard/bands/${result.data!.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Event name</Label>
            <Input
              id="name"
              required
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="The Basement Tapes — Fall Tour"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="A few sentences your members will see"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Schedule type</Label>
            <Select
              value={values.scheduleType}
              onValueChange={(v) => update("scheduleType", v as ScheduleType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                required
                value={values.startDate}
                onChange={(e) => update("startDate", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input
                id="endDate"
                type="date"
                required
                value={values.endDate}
                onChange={(e) => update("endDate", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Days of the week to include</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    values.activeDays.includes(day.value)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  {day.short}
                </button>
              ))}
            </div>
          </div>

          {values.scheduleType === "date_time" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="timeSlotStart">Time window start</Label>
                <Input
                  id="timeSlotStart"
                  type="time"
                  value={values.timeSlotStart}
                  onChange={(e) => update("timeSlotStart", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeSlotEnd">Time window end</Label>
                <Input
                  id="timeSlotEnd"
                  type="time"
                  value={values.timeSlotEnd}
                  onChange={(e) => update("timeSlotEnd", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeSlotMinutes">Slot length (minutes)</Label>
                <Input
                  id="timeSlotMinutes"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  value={values.timeSlotMinutes}
                  onChange={(e) => update("timeSlotMinutes", Number(e.target.value))}
                />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="eventDurationMinutes">Typical event duration (minutes)</Label>
              <Input
                id="eventDurationMinutes"
                type="number"
                min={0}
                max={1440}
                step={15}
                value={values.eventDurationMinutes}
                onChange={(e) => update("eventDurationMinutes", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={values.timezone} onValueChange={(v) => update("timezone", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Location type</Label>
            <Select
              value={values.locationType}
              onValueChange={(v) => update("locationType", v as LocationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCATION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location details (optional)</Label>
            <Input
              id="location"
              value={values.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="The Attic, 123 Main St"
            />
          </div>
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errors.map((err) => (
            <p key={err}>{err}</p>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : mode === "create" ? "Create event" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
