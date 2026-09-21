import "dotenv/config";
import { db } from "./index";
import { availabilityExceptions, availabilityWeekly, bandMembers, bands, profiles } from "./schema";
import { generateSlug } from "@/lib/slug";

async function main() {
  console.log("Seeding Downbeat demo data…");

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

  const [band] = await db
    .insert(bands)
    .values({ name: "The Basement Tapes", slug: generateSlug(), leaderId: leaderRow.id })
    .returning();

  const memberNames = ["Alex (guitar)", "Jordan (bass)", "Casey (drums)", "Riley (vocals)"];
  const members = await db
    .insert(bandMembers)
    .values(memberNames.map((name) => ({ bandId: band.id, name })))
    .returning();

  const weeklyRows = members.flatMap((member, i) =>
    [1, 2, 3, 4, 5].flatMap((dayOfWeek) =>
      ["evening"].map((timeBlock) => ({
        memberId: member.id,
        dayOfWeek,
        timeBlock,
        status: (dayOfWeek + i) % 3 === 0 ? "available" : (dayOfWeek + i) % 3 === 1 ? "maybe" : "unavailable",
      }))
    )
  );
  await db.insert(availabilityWeekly).values(weeklyRows);

  await db.insert(availabilityExceptions).values([
    {
      memberId: members[0].id,
      date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      status: "unavailable",
      note: "Out of town",
    },
  ]);

  console.log(`Done. Demo band link: /join/${band.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
