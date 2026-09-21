import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// profiles — band leader accounts. The only people who ever log in.
// On Supabase, profiles.id references auth.users(id); that FK lives in
// supabase/migrations (auth schema is not managed by Drizzle).
// ---------------------------------------------------------------------------
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// bands — one group a leader manages. `slug` is the public, shareable
// identifier used in the join link (no auth needed to view/use it).
// ---------------------------------------------------------------------------
export const bands = pgTable(
  "bands",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    leaderId: uuid("leader_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    leaderIdx: index("idx_bands_leader").on(table.leaderId),
  })
);

// ---------------------------------------------------------------------------
// band_members — a person in the band. No account, no password.
// `member_token` is the bearer credential embedded in their personal link
// (/a/[slug]/[memberToken]) — knowing it is how they prove who they are.
// ---------------------------------------------------------------------------
export const bandMembers = pgTable(
  "band_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bandId: uuid("band_id")
      .notNull()
      .references(() => bands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    instrument: text("instrument"),
    memberToken: uuid("member_token").notNull().default(sql`gen_random_uuid()`).unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    bandIdx: index("idx_band_members_band").on(table.bandId),
    tokenIdx: index("idx_band_members_token").on(table.memberToken),
  })
);

// ---------------------------------------------------------------------------
// availability_weekly — recurring "every week I'm usually..." grid.
// One row per (member, day of week, time block). Missing row = unavailable.
// ---------------------------------------------------------------------------
export const availabilityWeekly = pgTable(
  "availability_weekly",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    memberId: uuid("member_id")
      .notNull()
      .references(() => bandMembers.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday .. 6 = Saturday
    timeBlock: text("time_block").notNull(), // 'morning' | 'afternoon' | 'evening' | 'night'
    status: text("status").notNull().default("unavailable"), // 'available' | 'maybe' | 'unavailable'
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    memberIdx: index("idx_availability_weekly_member").on(table.memberId),
    memberSlotUnique: unique("availability_weekly_member_slot_unique").on(
      table.memberId,
      table.dayOfWeek,
      table.timeBlock
    ),
  })
);

// ---------------------------------------------------------------------------
// availability_exceptions — one-off overrides for a specific calendar date
// ("busy Dec 25 even though I'm normally free Wednesdays").
// ---------------------------------------------------------------------------
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    memberId: uuid("member_id")
      .notNull()
      .references(() => bandMembers.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").notNull(), // 'available' | 'maybe' | 'unavailable'
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    memberIdx: index("idx_availability_exceptions_member").on(table.memberId),
    memberDateUnique: unique("availability_exceptions_member_date_unique").on(
      table.memberId,
      table.date
    ),
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const profilesRelations = relations(profiles, ({ many }) => ({
  bands: many(bands),
}));

export const bandsRelations = relations(bands, ({ one, many }) => ({
  leader: one(profiles, { fields: [bands.leaderId], references: [profiles.id] }),
  members: many(bandMembers),
}));

export const bandMembersRelations = relations(bandMembers, ({ one, many }) => ({
  band: one(bands, { fields: [bandMembers.bandId], references: [bands.id] }),
  weeklyAvailability: many(availabilityWeekly),
  exceptions: many(availabilityExceptions),
}));

export const availabilityWeeklyRelations = relations(availabilityWeekly, ({ one }) => ({
  member: one(bandMembers, {
    fields: [availabilityWeekly.memberId],
    references: [bandMembers.id],
  }),
}));

export const availabilityExceptionsRelations = relations(
  availabilityExceptions,
  ({ one }) => ({
    member: one(bandMembers, {
      fields: [availabilityExceptions.memberId],
      references: [bandMembers.id],
    }),
  })
);
