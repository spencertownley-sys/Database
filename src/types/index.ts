import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  ships,
  regions,
  voyages,
  promotions,
  promoVoyages,
  disclaimers,
  promoDisclaimers,
  audienceSegments,
  promoAudiences,
  promoPerformance,
  activityLog,
  profiles,
} from "@/db/schema";
import type {
  OfferType,
  PromoStatus,
  UserRole,
  Market,
  BookingChannel,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// DB row types (inferred from Drizzle schema)
// ---------------------------------------------------------------------------
export type Ship = InferSelectModel<typeof ships>;
export type NewShip = InferInsertModel<typeof ships>;

export type Region = InferSelectModel<typeof regions>;
export type NewRegion = InferInsertModel<typeof regions>;

export type Voyage = InferSelectModel<typeof voyages>;
export type NewVoyage = InferInsertModel<typeof voyages>;

export type Promotion = InferSelectModel<typeof promotions>;
export type NewPromotion = InferInsertModel<typeof promotions>;

export type PromoVoyage = InferSelectModel<typeof promoVoyages>;
export type NewPromoVoyage = InferInsertModel<typeof promoVoyages>;

export type Disclaimer = InferSelectModel<typeof disclaimers>;
export type NewDisclaimer = InferInsertModel<typeof disclaimers>;

export type PromoDisclaimer = InferSelectModel<typeof promoDisclaimers>;

export type AudienceSegment = InferSelectModel<typeof audienceSegments>;
export type NewAudienceSegment = InferInsertModel<typeof audienceSegments>;

export type PromoAudience = InferSelectModel<typeof promoAudiences>;

export type PromoPerformance = InferSelectModel<typeof promoPerformance>;
export type NewPromoPerformance = InferInsertModel<typeof promoPerformance>;

export type ActivityLogEntry = InferSelectModel<typeof activityLog>;
export type NewActivityLogEntry = InferInsertModel<typeof activityLog>;

export type Profile = InferSelectModel<typeof profiles>;
export type NewProfile = InferInsertModel<typeof profiles>;

// ---------------------------------------------------------------------------
// JSONB shapes
// ---------------------------------------------------------------------------

/** promotions.offer_details */
export interface OfferDetails {
  discount_percent?: number;
  discount_amount?: number;
  obc_amount?: number;
  deposit_amount?: number;
  standard_deposit?: number;
  upgrade_from?: string;
  upgrade_to?: string;
  included_perks?: string[];
  combinable_with?: string[];
  [key: string]: unknown;
}

/** promotions.content — channel-specific content variants */
export interface PromoContent {
  web?: { title?: string; body?: string; cta?: string };
  email?: { subject?: string; body?: string };
  ta_portal?: { description?: string };
  [key: string]: unknown;
}

/** voyages.cabin_categories entries */
export interface CabinCategory {
  category: string;
  description: string;
  base_price: number;
  inventory: number;
}

/** voyages.metadata — flexible PIM attributes */
export interface VoyageMetadata {
  theme?: string;
  special_events?: string[];
  onboard_features?: string[];
  [key: string]: unknown;
}

/** audience_segments.criteria */
export interface AudienceCriteria {
  loyalty_tier?: string;
  min_points?: number;
  past_bookings?: { min?: number; max?: number };
  residency?: string[];
  age_min?: number;
  has_minor_guests?: boolean;
  [key: string]: unknown;
}

/** activity_log.changes — {field: {old, new}} */
export type ActivityChanges = Record<string, { old: unknown; new: unknown }>;

// ---------------------------------------------------------------------------
// Composite / view types used across the app
// ---------------------------------------------------------------------------
export interface PromotionWithRelations extends Promotion {
  owner?: Profile | null;
  approver?: Profile | null;
  voyageCount?: number;
  disclaimerCount?: number;
  audienceCount?: number;
}

export interface VoyageWithShip extends Voyage {
  ship?: Ship | null;
  region?: Region | null;
  activePromoCount?: number;
}

export interface SearchResult {
  id: string;
  type: "promotion" | "voyage" | "ship" | "disclaimer";
  title: string;
  subtitle?: string;
  url: string;
}

export interface SearchResults {
  promotions: SearchResult[];
  voyages: SearchResult[];
  ships: SearchResult[];
  disclaimers: SearchResult[];
}

export { type OfferType, type PromoStatus, type UserRole, type Market, type BookingChannel };
