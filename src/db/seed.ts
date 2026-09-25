import "dotenv/config";
import { format, addDays } from "date-fns";
import { db } from "./index";
import { availability, bandDayLabels, bandMembers, bands, profiles } from "./schema";
import { generateSlug } from "@/lib/slug";
import { getDateColumns, getTimeSlots } from "@/lib/band-settings";
import { AVAILABILITY_STATUSES } from "@/lib/constants";

async function main() {
  console.log("Seeding Downbeat demo data…");

  const existingBand = await db.query.bands.findFirst();
  if (existingBand) {
    console.log("A band already exists — skipping seed.");
    return;
  }

  const [leader] = await db
    .insert(profiles)
    .values({
      id: crypto.randomUUID(),
      email: "leader@downbeat.test",
      fullName: "Sam Rivera",
    })
    .onConflictDoNothing({ target: profiles.email })
    .returning();

  const leaderRow =
    leader ?? (await db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.email, "leader@downbeat.test") }));
  if (!leaderRow) throw new Error("Could not create or find demo leader");

  const today = new Date();
  const [band] = await db
    .insert(bands)
    .values({
      name: "The Basement Tapes — Fall Tour",
      slug: generateSlug(),
      leaderId: leaderRow.id,
      description: "Rehearsals and gigs for the fall run. Mark your availability below.",
      scheduleType: "date_time",
      startDate: format(today, "yyyy-MM-dd"),
      endDate: format(addDays(today, 27), "yyyy-MM-dd"),
      activeDays: [3, 5, 6], // Wed, Fri, Sat
      timeSlotStart: "17:00",
      timeSlotEnd: "22:00",
      timeSlotMinutes: 60,
      eventDurationMinutes: 120,
      location: "The Attic, 123 Main St",
      locationType: "in_person",
      timezone: "America/New_York",
    })
    .returning();

  const memberSeed = [
    { name: "Alex", instrument: "Guitar" },
    { name: "Jordan", instrument: "Bass" },
    { name: "Casey", instrument: "Drums" },
    { name: "Riley", instrument: "Vocals" },
  ];
  const members = await db
    .insert(bandMembers)
    .values(memberSeed.map((m) => ({ bandId: band.id, name: m.name, instrument: m.instrument })))
    .returning();

  const dateColumns = getDateColumns(band);
  const timeSlots = getTimeSlots(band);

  const availabilityRows = members.flatMap((member, memberIdx) =>
    dateColumns.flatMap((col, dateIdx) =>
      timeSlots.map((slot, slotIdx) => ({
        memberId: member.id,
        date: col.date,
        timeSlot: slot,
        status: AVAILABILITY_STATUSES[(memberIdx + dateIdx + slotIdx) % AVAILABILITY_STATUSES.length],
      }))
    )
  );
  if (availabilityRows.length > 0) {
    await db.insert(availability).values(availabilityRows);
  }

  if (dateColumns[0]) {
    await db.insert(bandDayLabels).values({
      bandId: band.id,
      date: dateColumns[0].date,
      label: "Load-in",
    });
  }

  console.log(`Done. Demo event link: /join/${band.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
