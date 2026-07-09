import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  date,
  numeric,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// profiles — app users with roles.
// On Supabase, profiles.id references auth.users(id); that FK lives in
// supabase/migrations (auth schema is not managed by Drizzle).
// ---------------------------------------------------------------------------
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("viewer"), // 'admin' | 'manager' | 'coordinator' | 'analyst' | 'viewer'
  department: text("department"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// ships — the fleet. Relatively static reference data.
// ---------------------------------------------------------------------------
export const ships = pgTable("ships", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  brand: text("brand").notNull(),
  shipClass: text("ship_class"),
  capacityGuests: integer("capacity_guests").notNull(),
  yearBuilt: integer("year_built"),
  homePort: text("home_port"),
  status: text("status").notNull().default("active"), // 'active' | 'drydock' | 'retired'
  imageUrl: text("image_url"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// regions — trade regions / deployment areas.
// ---------------------------------------------------------------------------
export const regions = pgTable("regions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// voyages — one row per sailing. The PIM "product catalog".
// ---------------------------------------------------------------------------
export const voyages = pgTable(
  "voyages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    voyageCode: text("voyage_code").notNull().unique(),
    shipId: uuid("ship_id")
      .notNull()
      .references(() => ships.id),
    regionId: uuid("region_id").references(() => regions.id),
    itineraryName: text("itinerary_name").notNull(),
    sailDate: date("sail_date").notNull(),
    returnDate: date("return_date").notNull(),
    durationNights: integer("duration_nights").notNull(),
    embarkPort: text("embark_port").notNull(),
    debarkPort: text("debark_port").notNull(),
    portsOfCall: text("ports_of_call").array(),
    status: text("status").notNull().default("open"), // 'open' | 'closed' | 'cancelled' | 'sailed'
    cabinCategories: jsonb("cabin_categories").default([]),
    occupancyPercent: numeric("occupancy_percent", { precision: 5, scale: 2 }),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    sailDateIdx: index("idx_voyages_sail_date").on(table.sailDate),
    shipIdIdx: index("idx_voyages_ship_id").on(table.shipId),
    regionIdIdx: index("idx_voyages_region_id").on(table.regionId),
    statusIdx: index("idx_voyages_status").on(table.status),
  })
);

// ---------------------------------------------------------------------------
// promotions — the core entity.
// The search_vector tsvector generated column + GIN index are added via raw
// SQL migration (Drizzle does not model tsvector generated columns).
// ---------------------------------------------------------------------------
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promoName: text("promo_name").notNull(),
    promoCode: text("promo_code").unique(),
    description: text("description"),

    // Offer details
    offerType: text("offer_type").notNull(),
    offerValue: text("offer_value").notNull(),
    offerDetails: jsonb("offer_details").default({}),

    // Timing
    sellStartDate: date("sell_start_date").notNull(),
    sellEndDate: date("sell_end_date").notNull(),
    sailStartDate: date("sail_start_date"),
    sailEndDate: date("sail_end_date"),

    // Targeting
    market: text("market").array(),
    bookingChannels: text("booking_channels").array(),
    isCombinable: boolean("is_combinable").default(false),

    // Workflow
    status: text("status").notNull().default("draft"),
    ownerId: uuid("owner_id").references(() => profiles.id),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    // Tracking
    source: text("source"),
    priority: text("priority").default("normal"),
    notes: text("notes"),
    tags: text("tags").array(),

    // PIM content fields
    headline: text("headline"),
    termsSummary: text("terms_summary"),
    content: jsonb("content").default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    statusIdx: index("idx_promotions_status").on(table.status),
    sellDatesIdx: index("idx_promotions_sell_dates").on(
      table.sellStartDate,
      table.sellEndDate
    ),
    promoCodeIdx: index("idx_promotions_promo_code").on(table.promoCode),
    ownerIdx: index("idx_promotions_owner").on(table.ownerId),
  })
);

// ---------------------------------------------------------------------------
// promo_voyages — the critical many-to-many junction.
// ---------------------------------------------------------------------------
export const promoVoyages = pgTable(
  "promo_voyages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    voyageId: uuid("voyage_id")
      .notNull()
      .references(() => voyages.id, { onDelete: "cascade" }),
    overrideOfferValue: text("override_offer_value"),
    overrideDetails: jsonb("override_details"),
    addedBy: uuid("added_by").references(() => profiles.id),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    promoIdx: index("idx_pv_promo").on(table.promoId),
    voyageIdx: index("idx_pv_voyage").on(table.voyageId),
    promoVoyageUnique: unique("promo_voyages_promo_id_voyage_id_unique").on(
      table.promoId,
      table.voyageId
    ),
  })
);

// ---------------------------------------------------------------------------
// disclaimers — reusable, versioned legal language.
// ---------------------------------------------------------------------------
export const disclaimers = pgTable("disclaimers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  disclaimerText: text("disclaimer_text").notNull(),
  version: integer("version").notNull().default(1),
  appliesToOfferTypes: text("applies_to_offer_types").array(),
  legalApprovedBy: text("legal_approved_by"),
  legalApprovedAt: timestamp("legal_approved_at", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // 'draft' | 'approved' | 'retired'
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const promoDisclaimers = pgTable(
  "promo_disclaimers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    disclaimerId: uuid("disclaimer_id")
      .notNull()
      .references(() => disclaimers.id),
  },
  (table) => ({
    promoDisclaimerUnique: unique(
      "promo_disclaimers_promo_id_disclaimer_id_unique"
    ).on(table.promoId, table.disclaimerId),
  })
);

// ---------------------------------------------------------------------------
// audience_segments — who the promo targets.
// ---------------------------------------------------------------------------
export const audienceSegments = pgTable("audience_segments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  criteria: jsonb("criteria").default({}),
  estimatedSize: integer("estimated_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const promoAudiences = pgTable(
  "promo_audiences",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => audienceSegments.id),
  },
  (table) => ({
    promoSegmentUnique: unique("promo_audiences_promo_id_segment_id_unique").on(
      table.promoId,
      table.segmentId
    ),
  })
);

// ---------------------------------------------------------------------------
// promo_performance — aggregated performance metrics.
// ---------------------------------------------------------------------------
export const promoPerformance = pgTable(
  "promo_performance",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promotions.id),
    voyageId: uuid("voyage_id").references(() => voyages.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    bookings: integer("bookings").default(0),
    revenue: numeric("revenue", { precision: 12, scale: 2 }).default("0"),
    redemptions: integer("redemptions").default(0),
    cancellations: integer("cancellations").default(0),
    avgBookingValue: numeric("avg_booking_value", { precision: 10, scale: 2 }),
    incrementalBookings: integer("incremental_bookings"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    perfPromoIdx: index("idx_perf_promo").on(table.promoId),
    perfVoyageIdx: index("idx_perf_voyage").on(table.voyageId),
  })
);

// ---------------------------------------------------------------------------
// activity_log — audit trail for all changes.
// ---------------------------------------------------------------------------
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    performedBy: uuid("performed_by").references(() => profiles.id),
    performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    entityIdx: index("idx_activity_entity").on(table.entityType, table.entityId),
    timeIdx: index("idx_activity_time").on(table.performedAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const shipsRelations = relations(ships, ({ many }) => ({
  voyages: many(voyages),
}));

export const regionsRelations = relations(regions, ({ many }) => ({
  voyages: many(voyages),
}));

export const voyagesRelations = relations(voyages, ({ one, many }) => ({
  ship: one(ships, { fields: [voyages.shipId], references: [ships.id] }),
  region: one(regions, { fields: [voyages.regionId], references: [regions.id] }),
  promoVoyages: many(promoVoyages),
  performance: many(promoPerformance),
}));

export const promotionsRelations = relations(promotions, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [promotions.ownerId],
    references: [profiles.id],
    relationName: "owner",
  }),
  approver: one(profiles, {
    fields: [promotions.approvedBy],
    references: [profiles.id],
    relationName: "approver",
  }),
  promoVoyages: many(promoVoyages),
  promoDisclaimers: many(promoDisclaimers),
  promoAudiences: many(promoAudiences),
  performance: many(promoPerformance),
}));

export const promoVoyagesRelations = relations(promoVoyages, ({ one }) => ({
  promo: one(promotions, {
    fields: [promoVoyages.promoId],
    references: [promotions.id],
  }),
  voyage: one(voyages, {
    fields: [promoVoyages.voyageId],
    references: [voyages.id],
  }),
  addedByProfile: one(profiles, {
    fields: [promoVoyages.addedBy],
    references: [profiles.id],
  }),
}));

export const disclaimersRelations = relations(disclaimers, ({ many }) => ({
  promoDisclaimers: many(promoDisclaimers),
}));

export const promoDisclaimersRelations = relations(
  promoDisclaimers,
  ({ one }) => ({
    promo: one(promotions, {
      fields: [promoDisclaimers.promoId],
      references: [promotions.id],
    }),
    disclaimer: one(disclaimers, {
      fields: [promoDisclaimers.disclaimerId],
      references: [disclaimers.id],
    }),
  })
);

export const audienceSegmentsRelations = relations(
  audienceSegments,
  ({ many }) => ({
    promoAudiences: many(promoAudiences),
  })
);

export const promoAudiencesRelations = relations(promoAudiences, ({ one }) => ({
  promo: one(promotions, {
    fields: [promoAudiences.promoId],
    references: [promotions.id],
  }),
  segment: one(audienceSegments, {
    fields: [promoAudiences.segmentId],
    references: [audienceSegments.id],
  }),
}));

export const promoPerformanceRelations = relations(
  promoPerformance,
  ({ one }) => ({
    promo: one(promotions, {
      fields: [promoPerformance.promoId],
      references: [promotions.id],
    }),
    voyage: one(voyages, {
      fields: [promoPerformance.voyageId],
      references: [voyages.id],
    }),
  })
);

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  performedByProfile: one(profiles, {
    fields: [activityLog.performedBy],
    references: [profiles.id],
  }),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  ownedPromotions: many(promotions, { relationName: "owner" }),
  approvedPromotions: many(promotions, { relationName: "approver" }),
  activities: many(activityLog),
}));
