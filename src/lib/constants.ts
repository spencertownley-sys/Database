export const OFFER_TYPES = [
  'percentage_discount',        // e.g. "20% off"
  'fixed_discount',             // e.g. "$500 off"
  'onboard_credit',             // e.g. "$200 OBC"
  'free_perk',                  // e.g. "Free Drinks Package"
  'reduced_deposit',            // e.g. "$100 deposit (was $500)"
  'upgrade',                    // e.g. "Free balcony upgrade"
  'companion_discount',         // e.g. "2nd guest sails free"
  'bundle',                     // e.g. "All-Inclusive Package"
  'loyalty_bonus',              // e.g. "Double points"
  'group_rate',                 // e.g. "Group rate: book 8+ cabins"
  'flash_sale',                 // e.g. "48-hour sale: 30% off"
  'other'
] as const;

export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  percentage_discount: 'Percentage Discount',
  fixed_discount: 'Fixed Discount',
  onboard_credit: 'Onboard Credit',
  free_perk: 'Free Perk',
  reduced_deposit: 'Reduced Deposit',
  upgrade: 'Upgrade',
  companion_discount: 'Companion Discount',
  bundle: 'Bundle',
  loyalty_bonus: 'Loyalty Bonus',
  group_rate: 'Group Rate',
  flash_sale: 'Flash Sale',
  other: 'Other',
};

export const PROMO_STATUSES = [
  'draft',                      // Just created, being built
  'pending_rm_data',            // Waiting for revenue management input
  'pending_voyage_list',        // Coordinator assembling voyage list
  'pending_legal',              // Waiting for legal disclaimer review
  'pending_approval',           // All pieces assembled, needs manager sign-off
  'approved',                   // Manager approved, ready to go live
  'live',                       // Currently active and bookable
  'paused',                     // Temporarily suspended
  'expired',                    // Past sell_end_date
  'cancelled'                   // Killed before or during run
] as const;

export type PromoStatus = (typeof PROMO_STATUSES)[number];

export const PROMO_STATUS_LABELS: Record<PromoStatus, string> = {
  draft: 'Draft',
  pending_rm_data: 'Pending RM Data',
  pending_voyage_list: 'Pending Voyage List',
  pending_legal: 'Pending Legal',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  live: 'Live',
  paused: 'Paused',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

// Status colors: Draft = slate, Pending = amber, Approved = emerald,
// Live = blue, Paused = orange, Expired = gray, Cancelled = red
export const PROMO_STATUS_COLORS: Record<
  PromoStatus,
  { badge: string; dot: string; hex: string }
> = {
  draft: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    dot: 'bg-slate-500',
    hex: '#64748b',
  },
  pending_rm_data: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
  },
  pending_voyage_list: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
    dot: 'bg-amber-500',
    hex: '#d97706',
  },
  pending_legal: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
    dot: 'bg-amber-500',
    hex: '#b45309',
  },
  pending_approval: {
    badge: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    dot: 'bg-amber-600',
    hex: '#92400e',
  },
  approved: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    hex: '#10b981',
  },
  live: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900',
    dot: 'bg-blue-500',
    hex: '#2563eb',
  },
  paused: {
    badge: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900',
    dot: 'bg-orange-500',
    hex: '#f97316',
  },
  expired: {
    badge: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    dot: 'bg-gray-400',
    hex: '#9ca3af',
  },
  cancelled: {
    badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
    dot: 'bg-red-500',
    hex: '#dc2626',
  },
};

export const USER_ROLES = {
  admin: { label: 'Admin', canCreate: true, canApprove: true, canDelete: true, canViewReports: true },
  manager: { label: 'Manager', canCreate: true, canApprove: true, canDelete: false, canViewReports: true },
  coordinator: { label: 'Coordinator', canCreate: true, canApprove: false, canDelete: false, canViewReports: false },
  analyst: { label: 'Analyst', canCreate: false, canApprove: false, canDelete: false, canViewReports: true },
  viewer: { label: 'Viewer', canCreate: false, canApprove: false, canDelete: false, canViewReports: false },
} as const;

export type UserRole = keyof typeof USER_ROLES;

export const REGIONS = [
  { name: 'Alaska', code: 'AK' },
  { name: 'Caribbean - Eastern', code: 'CBE' },
  { name: 'Caribbean - Western', code: 'CBW' },
  { name: 'Caribbean - Southern', code: 'CBS' },
  { name: 'Mediterranean - Western', code: 'MDW' },
  { name: 'Mediterranean - Eastern', code: 'MDE' },
  { name: 'Northern Europe', code: 'NEU' },
  { name: 'Bermuda', code: 'BDA' },
  { name: 'Bahamas', code: 'BAH' },
  { name: 'Transatlantic', code: 'TRA' },
  { name: 'Hawaii', code: 'HAW' },
  { name: 'Panama Canal', code: 'PAN' },
  { name: 'Asia', code: 'ASI' },
  { name: 'Australia & New Zealand', code: 'ANZ' },
  { name: 'South America', code: 'SAM' },
  { name: 'Repositioning', code: 'REP' },
] as const;

export const MARKETS = ['NA', 'UK', 'EU', 'AU', 'APAC', 'LATAM', 'Global'] as const;
export type Market = (typeof MARKETS)[number];

export const BOOKING_CHANNELS = ['direct', 'ta', 'ota', 'group', 'charter', 'loyalty'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const BOOKING_CHANNEL_LABELS: Record<BookingChannel, string> = {
  direct: 'Direct',
  ta: 'Travel Agent',
  ota: 'OTA',
  group: 'Group',
  charter: 'Charter',
  loyalty: 'Loyalty',
};

export const PROMO_SOURCES = [
  'rm_recommendation',
  'competitive_response',
  'seasonal',
  'clearance',
  'partnership',
] as const;
export type PromoSource = (typeof PROMO_SOURCES)[number];

export const PROMO_SOURCE_LABELS: Record<PromoSource, string> = {
  rm_recommendation: 'RM Recommendation',
  competitive_response: 'Competitive Response',
  seasonal: 'Seasonal',
  clearance: 'Clearance',
  partnership: 'Partnership',
};

export const PROMO_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type PromoPriority = (typeof PROMO_PRIORITIES)[number];

export const VOYAGE_STATUSES = ['open', 'closed', 'cancelled', 'sailed'] as const;
export type VoyageStatus = (typeof VOYAGE_STATUSES)[number];

export const SHIP_STATUSES = ['active', 'drydock', 'retired'] as const;
export type ShipStatus = (typeof SHIP_STATUSES)[number];

export const DISCLAIMER_STATUSES = ['draft', 'approved', 'retired'] as const;
export type DisclaimerStatus = (typeof DISCLAIMER_STATUSES)[number];

// Allowed status transitions for the promo workflow.
export const STATUS_TRANSITIONS: Record<PromoStatus, PromoStatus[]> = {
  draft: ['pending_rm_data', 'pending_voyage_list', 'pending_legal', 'pending_approval', 'cancelled'],
  pending_rm_data: ['pending_voyage_list', 'pending_legal', 'pending_approval', 'draft', 'cancelled'],
  pending_voyage_list: ['pending_legal', 'pending_approval', 'draft', 'cancelled'],
  pending_legal: ['pending_approval', 'draft', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['live', 'pending_approval', 'cancelled'],
  live: ['paused', 'expired', 'cancelled'],
  paused: ['live', 'expired', 'cancelled'],
  expired: [],
  cancelled: [],
};

// Statuses only a manager/admin (canApprove) may move a promo INTO.
export const APPROVAL_REQUIRED_STATUSES: PromoStatus[] = ['approved', 'live'];

// Statuses considered "active" for conflict/no-promo indicators.
export const ACTIVE_PROMO_STATUSES: PromoStatus[] = ['approved', 'live', 'paused'];
