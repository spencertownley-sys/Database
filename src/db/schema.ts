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
// profiles — band leader (and, optionally, member) accounts.
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
// bands — one event/schedule a leader manages. `slug` is the public,
// shareable identifier used in the join link (no auth needed to view/use it).
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
    description: text("description"),

    // Schedule shape
    scheduleType: text("schedule_type").notNull().default("date_time"), // 'date_time' | 'date_only'
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    activeDays: integer("active_days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'::int[]`),

    // Time-of-day grid (only meaningful when scheduleType === 'date_time')
    timeSlotStart: text("time_slot_start").notNull().default("17:00"), // "HH:MM"
    timeSlotEnd: text("time_slot_end").notNull().default("22:00"), // "HH:MM"
    timeSlotMinutes: integer("time_slot_minutes").notNull().default(60),
    eventDurationMinutes: integer("event_duration_minutes").notNull().default(120),

    // Event details
    location: text("location"),
    locationType: text("location_type").notNull().default("tbd"), // 'in_person' | 'virtual' | 'tbd'
    timezone: text("timezone").notNull().default("America/New_York"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    leaderIdx: index("idx_bands_leader").on(table.leaderId),
  })
);

// ---------------------------------------------------------------------------
// band_day_labels — leader-authored labels tagging specific dates in a
// band's range, e.g. "Load-in", "Soundcheck". One label per (band, date).
// ---------------------------------------------------------------------------
export const bandDayLabels = pgTable(
  "band_day_labels",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bandId: uuid("band_id")
      .notNull()
      .references(() => bands.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    bandIdx: index("idx_band_day_labels_band").on(table.bandId),
    bandDateUnique: unique("band_day_labels_band_date_unique").on(table.bandId, table.date),
  })
);

// ---------------------------------------------------------------------------
// band_members — a person in the band. No account required. `member_token`
// is the bearer credential embedded in their personal link
// (/a/[slug]/[memberToken]) — knowing it is how they prove who they are.
// `profile_id` is set only if/when they link this row to a real account.
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
    contact: text("contact"),
    memberToken: uuid("member_token").notNull().default(sql`gen_random_uuid()`).unique(),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    bandIdx: index("idx_band_members_band").on(table.bandId),
    tokenIdx: index("idx_band_members_token").on(table.memberToken),
    profileIdx: index("idx_band_members_profile").on(table.profileId),
  })
);

// ---------------------------------------------------------------------------
// availability — one row per (member, calendar date, time slot). Missing
// row = unfilled (member hasn't responded yet). `time_slot` is "HH:MM", or
// the ALL_DAY_SLOT sentinel for date-only bands.
// ---------------------------------------------------------------------------
export const availability = pgTable(
  "availability",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    memberId: uuid("member_id")
      .notNull()
      .references(() => bandMembers.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    timeSlot: text("time_slot").notNull(),
    status: text("status").notNull(), // 'conflict' | 'maybe' | 'available' | 'preferred'
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    memberIdx: index("idx_availability_member").on(table.memberId),
    memberSlotUnique: unique("availability_member_date_slot_unique").on(
      table.memberId,
      table.date,
      table.timeSlot
    ),
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const profilesRelations = relations(profiles, ({ many }) => ({
  bands: many(bands),
  memberships: many(bandMembers),
}));

export const bandsRelations = relations(bands, ({ one, many }) => ({
  leader: one(profiles, { fields: [bands.leaderId], references: [profiles.id] }),
  members: many(bandMembers),
  dayLabels: many(bandDayLabels),
}));

export const bandDayLabelsRelations = relations(bandDayLabels, ({ one }) => ({
  band: one(bands, { fields: [bandDayLabels.bandId], references: [bands.id] }),
}));

export const bandMembersRelations = relations(bandMembers, ({ one, many }) => ({
  band: one(bands, { fields: [bandMembers.bandId], references: [bands.id] }),
  profile: one(profiles, { fields: [bandMembers.profileId], references: [profiles.id] }),
  availability: many(availability),
}));

export const availabilityRelations = relations(availability, ({ one }) => ({
  member: one(bandMembers, {
    fields: [availability.memberId],
    references: [bandMembers.id],
  }),
}));
