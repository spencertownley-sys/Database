/**
 * PromoVault seed script.
 *
 * Generates 2+ years of realistic, interconnected cruise promotion history:
 * ships, regions, voyages, audience segments, disclaimers, promotions with
 * voyage/disclaimer/audience links, performance data, an activity log, and
 * five test users.
 *
 * Run with: npx tsx src/db/seed.ts
 *
 * Uses a seeded LCG so repeated runs produce identical data (relative to the
 * run date — promo statuses like 'live' are anchored to "today").
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import * as schema from "./schema";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  startOfMonth,
  endOfMonth,
  min as minDate,
} from "date-fns";

// ---------------------------------------------------------------------------
// Deterministic RNG (LCG)
// ---------------------------------------------------------------------------
let rngState = 42;
function rand(): number {
  // Numerical Recipes LCG constants
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  const count = Math.min(n, copy.length);
  for (let i = 0; i < count; i++) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  }
  return out;
}
function chance(p: number): boolean {
  return rand() < p;
}

// Deterministic UUID v4-shaped ids from the seeded RNG.
function seededUuid(): string {
  const hex = () => Math.floor(rand() * 16).toString(16);
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += ((Math.floor(rand() * 4) + 8).toString(16));
    else s += hex();
  }
  return s;
}

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const WINDOW_START = new Date("2025-01-01T00:00:00");
const WINDOW_END = new Date("2027-12-31T00:00:00");

const iso = (d: Date) => format(d, "yyyy-MM-dd");

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const SHIPS = [
  { name: "Celestial Odyssey", brand: "Celestial Cruises", ship_class: "Odyssey", capacity_guests: 5400, year_built: 2022, home_port: "Miami, FL" },
  { name: "Celestial Horizon", brand: "Celestial Cruises", ship_class: "Horizon", capacity_guests: 4200, year_built: 2019, home_port: "Fort Lauderdale, FL" },
  { name: "Celestial Radiance", brand: "Celestial Cruises", ship_class: "Radiance", capacity_guests: 3800, year_built: 2016, home_port: "Barcelona, Spain" },
  { name: "Celestial Apex", brand: "Celestial Cruises", ship_class: "Apex", capacity_guests: 4600, year_built: 2023, home_port: "Miami, FL" },
  { name: "Celestial Eclipse", brand: "Celestial Cruises", ship_class: "Eclipse", capacity_guests: 3200, year_built: 2014, home_port: "Southampton, UK" },
  { name: "Celestial Solstice", brand: "Celestial Cruises", ship_class: "Solstice", capacity_guests: 3400, year_built: 2017, home_port: "Seattle, WA" },
  { name: "Celestial Voyager", brand: "Celestial Cruises", ship_class: "Voyager", capacity_guests: 4800, year_built: 2024, home_port: "Galveston, TX" },
  { name: "Celestial Serenity", brand: "Celestial Cruises", ship_class: "Serenity", capacity_guests: 2800, year_built: 2012, home_port: "Rome (Civitavecchia), Italy" },
  { name: "Celestial Zenith", brand: "Celestial Cruises", ship_class: "Zenith", capacity_guests: 5000, year_built: 2025, home_port: "Miami, FL" },
  { name: "Celestial Aurora", brand: "Celestial Cruises", ship_class: "Aurora", capacity_guests: 3600, year_built: 2018, home_port: "San Juan, PR" },
  { name: "Celestial Meridian", brand: "Celestial Cruises", ship_class: "Meridian", capacity_guests: 4000, year_built: 2020, home_port: "Copenhagen, Denmark" },
  { name: "Celestial Jewel", brand: "Celestial Cruises", ship_class: "Jewel", capacity_guests: 2600, year_built: 2010, home_port: "Sydney, Australia" },
  { name: "Celestial Summit", brand: "Celestial Cruises", ship_class: "Summit", capacity_guests: 4400, year_built: 2021, home_port: "New York, NY" },
  { name: "Celestial Breeze", brand: "Celestial Cruises", ship_class: "Breeze", capacity_guests: 3000, year_built: 2015, home_port: "Tampa, FL" },
  { name: "Celestial Majestic", brand: "Celestial Cruises", ship_class: "Majestic", capacity_guests: 5200, year_built: 2026, home_port: "Miami, FL" },
  { name: "Celestial Rhapsody", brand: "Celestial Cruises", ship_class: "Rhapsody", capacity_guests: 3400, year_built: 2013, home_port: "Los Angeles, CA" },
  { name: "Celestial Prism", brand: "Celestial Cruises", ship_class: "Prism", capacity_guests: 4100, year_built: 2023, home_port: "Singapore" },
];

const REGIONS = [
  { name: "Alaska", code: "AK", description: "Alaska Inside Passage and Gulf of Alaska sailings, May–September." },
  { name: "Caribbean - Eastern", code: "CBE", description: "Eastern Caribbean: St. Thomas, St. Maarten, Puerto Rico." },
  { name: "Caribbean - Western", code: "CBW", description: "Western Caribbean: Cozumel, Grand Cayman, Jamaica." },
  { name: "Caribbean - Southern", code: "CBS", description: "Southern Caribbean: Aruba, Curaçao, Barbados." },
  { name: "Mediterranean - Western", code: "MDW", description: "Western Med: Barcelona, Rome, French Riviera." },
  { name: "Mediterranean - Eastern", code: "MDE", description: "Eastern Med: Greek Isles, Turkey, Adriatic." },
  { name: "Northern Europe", code: "NEU", description: "Baltic capitals, Norwegian fjords, British Isles." },
  { name: "Bermuda", code: "BDA", description: "Bermuda sailings from the US East Coast." },
  { name: "Bahamas", code: "BAH", description: "Short Bahamas getaways: Nassau and private island." },
  { name: "Transatlantic", code: "TRA", description: "Transatlantic crossings and repositioning voyages." },
  { name: "Hawaii", code: "HAW", description: "Hawaiian Islands sailings." },
  { name: "Panama Canal", code: "PAN", description: "Full and partial Panama Canal transits." },
  { name: "Asia", code: "ASI", description: "Southeast Asia and Japan itineraries." },
  { name: "Australia & New Zealand", code: "ANZ", description: "Australia and New Zealand deployments, austral summer." },
  { name: "South America", code: "SAM", description: "South America and Antarctica-adjacent itineraries." },
  { name: "Repositioning", code: "REP", description: "One-way repositioning voyages between deployment regions." },
];

interface RegionProfile {
  durations: number[];
  embarkPorts: string[];
  ports: string[];
  itineraries: string[]; // {n} replaced with nights
}

const REGION_PROFILES: Record<string, RegionProfile> = {
  AK: {
    durations: [7, 7, 7, 10],
    embarkPorts: ["Seattle, WA", "Vancouver, BC", "Anchorage (Whittier), AK"],
    ports: ["Juneau", "Skagway", "Ketchikan", "Icy Strait Point", "Sitka", "Glacier Bay (cruising)", "Hubbard Glacier (cruising)", "Victoria, BC"],
    itineraries: ["{n}-Night Alaska Inside Passage", "{n}-Night Alaska Glacier Explorer", "{n}-Night Alaska Dawes Glacier", "{n}-Night Alaska Northbound Glacier"],
  },
  CBE: {
    durations: [7, 7, 5, 8],
    embarkPorts: ["Miami, FL", "Fort Lauderdale, FL", "Cape Liberty, NJ", "San Juan, PR"],
    ports: ["Perfect Cove Cay", "St. Thomas", "St. Maarten", "San Juan", "Tortola", "Antigua", "St. Kitts"],
    itineraries: ["{n}-Night Eastern Caribbean & Perfect Cove Cay", "{n}-Night Eastern Caribbean Escape", "{n}-Night Eastern Caribbean Islands"],
  },
  CBW: {
    durations: [5, 6, 7, 7],
    embarkPorts: ["Miami, FL", "Galveston, TX", "Tampa, FL", "New Orleans, LA"],
    ports: ["Cozumel", "Costa Maya", "Roatan", "Grand Cayman", "Falmouth", "Ocho Rios", "Belize City"],
    itineraries: ["{n}-Night Western Caribbean Adventure", "{n}-Night Western Caribbean & Cozumel", "{n}-Night Western Caribbean Getaway"],
  },
  CBS: {
    durations: [7, 8, 10, 10],
    embarkPorts: ["San Juan, PR", "Fort Lauderdale, FL", "Bridgetown, Barbados"],
    ports: ["Aruba", "Curaçao", "Bonaire", "Barbados", "St. Lucia", "Grenada", "Martinique"],
    itineraries: ["{n}-Night Southern Caribbean Explorer", "{n}-Night ABC Islands", "{n}-Night Southern Caribbean Hideaways"],
  },
  MDW: {
    durations: [7, 7, 10],
    embarkPorts: ["Barcelona, Spain", "Rome (Civitavecchia), Italy", "Marseille, France"],
    ports: ["Palma de Mallorca", "Marseille", "Genoa", "Florence (Livorno)", "Naples", "Valencia", "Ibiza", "Ajaccio"],
    itineraries: ["{n}-Night Western Mediterranean", "{n}-Night Spain, France & Italy", "{n}-Night Mediterranean Riviera"],
  },
  MDE: {
    durations: [7, 10, 10, 12],
    embarkPorts: ["Rome (Civitavecchia), Italy", "Athens (Piraeus), Greece", "Venice (Ravenna), Italy"],
    ports: ["Santorini", "Mykonos", "Rhodes", "Kusadasi (Ephesus)", "Istanbul", "Dubrovnik", "Kotor", "Crete (Chania)"],
    itineraries: ["{n}-Night Greek Isles & Turkey", "{n}-Night Greek Isles Odyssey", "{n}-Night Adriatic & Aegean"],
  },
  NEU: {
    durations: [7, 10, 12],
    embarkPorts: ["Copenhagen, Denmark", "Southampton, UK", "Amsterdam, Netherlands", "Stockholm, Sweden"],
    ports: ["Oslo", "Geiranger", "Bergen", "Tallinn", "Helsinki", "Stockholm", "Visby", "Flam", "Alesund"],
    itineraries: ["{n}-Night Norwegian Fjords", "{n}-Night Scandinavia & Baltic", "{n}-Night British Isles & Ireland"],
  },
  BDA: {
    durations: [5, 6, 7],
    embarkPorts: ["Cape Liberty, NJ", "New York, NY", "Boston, MA", "Baltimore, MD"],
    ports: ["King's Wharf (overnight)", "Hamilton", "St. George's"],
    itineraries: ["{n}-Night Bermuda Getaway", "{n}-Night Bermuda & Perfect Cove Cay", "{n}-Night Bermuda Escape"],
  },
  BAH: {
    durations: [3, 4, 4, 5],
    embarkPorts: ["Miami, FL", "Fort Lauderdale, FL", "Port Canaveral, FL", "Tampa, FL"],
    ports: ["Nassau", "Perfect Cove Cay", "Freeport", "Bimini"],
    itineraries: ["{n}-Night Bahamas Getaway", "{n}-Night Bahamas & Perfect Cove Cay", "{n}-Night Weekend Bahamas Escape"],
  },
  TRA: {
    durations: [12, 13, 14],
    embarkPorts: ["Miami, FL", "Fort Lauderdale, FL", "Barcelona, Spain", "Southampton, UK"],
    ports: ["Ponta Delgada (Azores)", "Funchal (Madeira)", "Tenerife", "Lisbon", "Malaga"],
    itineraries: ["{n}-Night Transatlantic Crossing", "{n}-Night Transatlantic & Azores", "{n}-Night Westbound Transatlantic"],
  },
  HAW: {
    durations: [10, 12, 14],
    embarkPorts: ["Los Angeles, CA", "San Francisco, CA", "Honolulu, HI", "Vancouver, BC"],
    ports: ["Honolulu (overnight)", "Maui (Lahaina)", "Kauai (Nawiliwili)", "Hilo", "Kona", "Ensenada"],
    itineraries: ["{n}-Night Hawaii Islands", "{n}-Night Hawaii Round-Trip", "{n}-Night Hawaiian Escape"],
  },
  PAN: {
    durations: [10, 11, 14, 15],
    embarkPorts: ["Fort Lauderdale, FL", "Miami, FL", "Los Angeles, CA", "Colon, Panama"],
    ports: ["Panama Canal (full transit)", "Cartagena", "Colon", "Puntarenas", "Cabo San Lucas", "Puerto Vallarta", "Grand Cayman"],
    itineraries: ["{n}-Night Panama Canal Full Transit", "{n}-Night Panama Canal & Central America", "{n}-Night Panama Canal Partial Transit"],
  },
  ASI: {
    durations: [7, 10, 12],
    embarkPorts: ["Singapore", "Hong Kong", "Tokyo (Yokohama), Japan", "Shanghai, China"],
    ports: ["Phuket", "Penang", "Kuala Lumpur (Port Klang)", "Ho Chi Minh City", "Bangkok (Laem Chabang)", "Nha Trang", "Kobe", "Okinawa", "Busan"],
    itineraries: ["{n}-Night Southeast Asia", "{n}-Night Best of Japan", "{n}-Night Singapore & Thailand"],
  },
  ANZ: {
    durations: [7, 10, 12, 14],
    embarkPorts: ["Sydney, Australia", "Brisbane, Australia", "Auckland, New Zealand", "Melbourne, Australia"],
    ports: ["Milford Sound (cruising)", "Dunedin", "Wellington", "Tauranga", "Bay of Islands", "Hobart", "Airlie Beach", "Cairns (Yorkeys Knob)", "Noumea", "Mystery Island"],
    itineraries: ["{n}-Night New Zealand", "{n}-Night South Pacific & Fiji", "{n}-Night Great Barrier Reef", "{n}-Night Australia & New Zealand"],
  },
  SAM: {
    durations: [10, 12, 14],
    embarkPorts: ["Buenos Aires, Argentina", "Santiago (Valparaiso), Chile", "Rio de Janeiro, Brazil"],
    ports: ["Montevideo", "Puerto Madryn", "Punta Arenas", "Ushuaia", "Cape Horn (cruising)", "Puerto Montt", "Falkland Islands (Stanley)"],
    itineraries: ["{n}-Night South America & Patagonia", "{n}-Night Cape Horn & Strait of Magellan", "{n}-Night Brazil & Argentina"],
  },
  REP: {
    durations: [5, 7, 9, 11],
    embarkPorts: ["Miami, FL", "Barcelona, Spain", "Seattle, WA", "Sydney, Australia", "Singapore", "Los Angeles, CA"],
    ports: ["Cartagena", "Lisbon", "Tenerife", "Cabo San Lucas", "Honolulu", "Suva", "Colombo", "Dubai"],
    itineraries: ["{n}-Night Repositioning Voyage", "{n}-Night One-Way Repositioning", "{n}-Night Repositioning Cruise"],
  },
};

// Seasonal deployment plans keyed by home-port style. Month index 0–11 → region code.
type DeploymentPlan = (month: number) => string;

const DEPLOYMENTS: Record<string, DeploymentPlan> = {
  // Florida/Gulf ships: Caribbean year-round, heavier Bahamas in summer
  florida: (m) => pick(m >= 4 && m <= 8 ? ["CBE", "CBW", "BAH", "CBE", "CBW"] : ["CBE", "CBW", "CBS", "BAH"]),
  // Seattle/Vancouver: Alaska in summer, Caribbean/Hawaii in winter
  alaska: (m) => (m >= 4 && m <= 8 ? "AK" : pick(["HAW", "CBW", "PAN"])),
  // Mediterranean ships: Med in Apr–Oct, Caribbean in winter
  med: (m) => (m >= 3 && m <= 9 ? pick(["MDW", "MDE"]) : pick(["CBE", "CBS", "TRA"])),
  // Northern Europe: NEU Jun–Aug, Med shoulder, Caribbean winter
  northern: (m) =>
    m >= 5 && m <= 7 ? "NEU" : m === 4 || m === 8 || m === 9 ? pick(["MDW", "NEU"]) : pick(["CBE", "CBS"]),
  // Northeast US: Bermuda May–Sep, Bahamas/Caribbean winter
  northeast: (m) => (m >= 4 && m <= 8 ? "BDA" : pick(["BAH", "CBE"])),
  // Australia: ANZ Oct–Mar (austral summer), Asia rest
  australia: (m) => (m >= 9 || m <= 2 ? "ANZ" : "ASI"),
  // Asia year-round
  asia: () => "ASI",
  // West coast: Hawaii/Mexico/Panama
  westcoast: (m) => pick(m >= 9 || m <= 3 ? ["HAW", "PAN", "HAW"] : ["HAW", "AK"]),
  // South America seasonal ship
  southamerica: (m) => (m >= 10 || m <= 2 ? "SAM" : pick(["PAN", "CBS"])),
};

function planForShip(homePort: string): DeploymentPlan {
  if (homePort.includes("Seattle")) return DEPLOYMENTS.alaska;
  if (homePort.includes("Southampton") || homePort.includes("Copenhagen")) return DEPLOYMENTS.northern;
  if (homePort.includes("Barcelona") || homePort.includes("Rome")) return DEPLOYMENTS.med;
  if (homePort.includes("New York")) return DEPLOYMENTS.northeast;
  if (homePort.includes("Sydney")) return DEPLOYMENTS.australia;
  if (homePort.includes("Singapore")) return DEPLOYMENTS.asia;
  if (homePort.includes("Los Angeles")) return DEPLOYMENTS.westcoast;
  if (homePort.includes("San Juan")) return DEPLOYMENTS.southamerica;
  return DEPLOYMENTS.florida;
}

const AUDIENCES = [
  { name: "All Guests", description: "No targeting restrictions", criteria: {} },
  { name: "Past Cruisers", description: "Guests who have sailed with us before", criteria: { past_bookings: { min: 1 } } },
  { name: "Past Cruisers - Platinum+", description: "Loyalty tier Platinum and above", criteria: { loyalty_tier: "platinum" } },
  { name: "New to Brand", description: "First-time cruisers who have never sailed with us", criteria: { past_bookings: { max: 0 } } },
  { name: "New to Cruise", description: "Guests who have never cruised with any line", criteria: { never_cruised: true } },
  { name: "Loyalty 50K+ Points", description: "Guests with 50,000+ loyalty points", criteria: { min_points: 50000 } },
  { name: "Lapsed Cruisers", description: "Past guests who have not sailed in 2+ years", criteria: { last_sailing_before_years: 2 } },
  { name: "Suite Guests", description: "Guests who have booked a suite category", criteria: { cabin_history: ["suite"] } },
  { name: "Group Leaders", description: "Travel advisors and group booking organizers", criteria: { channel: ["group", "ta"] } },
  { name: "Military & Veterans", description: "Active duty, reserves, and veterans", criteria: { military: true } },
  { name: "Residents - Florida", description: "Guests with Florida home addresses", criteria: { residency: ["FL"] } },
  { name: "Residents - Texas/Gulf", description: "Guests in TX, LA, MS, AL", criteria: { residency: ["TX", "LA", "MS", "AL"] } },
  { name: "Seniors 55+", description: "Guests age 55 and older", criteria: { age_min: 55 } },
  { name: "Families", description: "Bookings with guests under 18", criteria: { has_minor_guests: true } },
];

const DISCLAIMER_TEMPLATES = [
  {
    name: "General Promotional Terms",
    applies: ["percentage_discount", "fixed_discount", "bundle", "other"],
    text: "Offer is capacity controlled, subject to availability, and may be withdrawn or modified at any time without notice. Deposit is non-refundable for bookings made under this promotion unless otherwise stated. Offer applies to new individual bookings only and is not applicable to charters or contracted groups. Prices are per person, based on double occupancy, in USD. Ships' registry: Bahamas.",
  },
  {
    name: "Onboard Credit Terms",
    applies: ["onboard_credit"],
    text: "Onboard credit (OBC) is per stateroom, based on double occupancy, and is non-transferable and non-refundable. OBC has no cash value, is not redeemable for cash, and expires at 10:00 PM on the final night of the voyage. OBC may not be used in the medical center, art auctions, or casino cash advances.",
  },
  {
    name: "Percentage Discount Terms",
    applies: ["percentage_discount", "flash_sale"],
    text: "Discount applies to cruise fare only and does not apply to taxes, fees, port expenses, gratuities, or other charges. Savings vary by stateroom category and sailing. Offer is not combinable with any other offer or promotion unless expressly stated. Full deposit is required at time of booking.",
  },
  {
    name: "Free Perk Selection Terms",
    applies: ["free_perk", "bundle"],
    text: "Complimentary amenity must be selected at time of booking and cannot be added, changed, or substituted after booking is confirmed. Amenities apply to the first and second guests in the stateroom only. Beverage package guests must be 21 years of age or older to receive alcoholic options. Amenity has no cash value and is forfeited if unused.",
  },
  {
    name: "Reduced Deposit Terms",
    applies: ["reduced_deposit"],
    text: "Reduced deposit applies at the time of booking only; the remaining deposit balance and full payment are due by the final payment date shown on the booking confirmation. Reduced deposit bookings that cancel prior to final payment forfeit the deposit paid. Not applicable to suites or holiday sailings.",
  },
  {
    name: "Combinability Rules",
    applies: ["percentage_discount", "onboard_credit", "loyalty_bonus"],
    text: "This offer is combinable with the loyalty program onboard discount and one (1) national promotional offer in market at time of booking, unless otherwise noted. It is not combinable with net rates, interline rates, travel agent rates, or employee rates. In the event of a conflict, the highest-value combinable offer will be applied automatically.",
  },
  {
    name: "Residency Offer Terms",
    applies: ["percentage_discount", "fixed_discount", "other"],
    text: "Residency-based savings require proof of eligible residency (valid government-issued ID) at time of check-in. Guests unable to provide proof of residency will be charged the prevailing fare difference. Offer applies to the first and second guests in the stateroom and is available in eligible markets only.",
  },
  {
    name: "Flash Sale Terms",
    applies: ["flash_sale"],
    text: "Offer valid only during the stated booking window and will not be extended. Capacity controlled and available on select sailings and stateroom categories only, which may sell out before the sale ends. No price protection: bookings made outside the window are not eligible for retroactive adjustment.",
  },
  {
    name: "Companion Fare Terms",
    applies: ["companion_discount"],
    text: "Second guest offer applies to the second guest booked in the same stateroom as the first full-fare guest. Taxes, fees, and port expenses remain payable for both guests. Offer is not applicable to single occupancy bookings, third or fourth guests, or upper-berth capacity staterooms.",
  },
  {
    name: "Upgrade Offer Terms",
    applies: ["upgrade"],
    text: "Complimentary upgrade is subject to availability within like-to-like stateroom categories at time of booking and cannot be requested after booking confirmation. Upgrade applies to the stateroom category only and does not include additional amenities associated with the upgraded category. Not applicable to guarantee (GTY) bookings.",
  },
  {
    name: "Group Rate Terms",
    applies: ["group_rate"],
    text: "Group rates require a minimum of eight (8) staterooms booked and deposited under a single group contract. Group amenities are allocated per the group amenity points program and vary by sailing. Names are required at time of deposit; unnamed berths are subject to recall at the line's discretion.",
  },
  {
    name: "Loyalty Bonus Terms",
    applies: ["loyalty_bonus"],
    text: "Bonus loyalty points are awarded within four (4) weeks of voyage completion and apply to the loyalty account of record for each qualifying guest. Points have no cash value and are subject to the loyalty program terms and conditions. Offer applies to sailings booked and completed within the stated promotional window.",
  },
];

const TEST_USERS = [
  { id: "00000000-0000-4000-8000-000000000001", email: "admin@promovault.test", fullName: "Ava Admin", role: "admin", department: "Marketing Technology" },
  { id: "00000000-0000-4000-8000-000000000002", email: "manager@promovault.test", fullName: "Marcus Manager", role: "manager", department: "Promotion Management" },
  { id: "00000000-0000-4000-8000-000000000003", email: "coordinator1@promovault.test", fullName: "Cora Coordinator", role: "coordinator", department: "Promotion Operations" },
  { id: "00000000-0000-4000-8000-000000000004", email: "coordinator2@promovault.test", fullName: "Colin Fields", role: "coordinator", department: "Promotion Operations" },
  { id: "00000000-0000-4000-8000-000000000005", email: "analyst@promovault.test", fullName: "Nia Analyst", role: "analyst", department: "Revenue Analytics" },
];

// ---------------------------------------------------------------------------
// Promotion name/offer generators
// ---------------------------------------------------------------------------
const OFFER_GENERATORS: {
  type: string;
  weight: number;
  gen: () => { value: string; details: Record<string, unknown> };
}[] = [
  { type: "percentage_discount", weight: 22, gen: () => { const p = pick([10, 15, 20, 25, 30]); return { value: `${p}% off cruise fare`, details: { discount_percent: p } }; } },
  { type: "fixed_discount", weight: 10, gen: () => { const a = pick([100, 150, 200, 300, 500]); return { value: `$${a} off per stateroom`, details: { discount_amount: a } }; } },
  { type: "onboard_credit", weight: 18, gen: () => { const a = pick([50, 75, 100, 150, 200, 300, 500]); return { value: `$${a} onboard credit`, details: { obc_amount: a } }; } },
  { type: "free_perk", weight: 12, gen: () => { const perk = pick(["Classic Drinks Package", "Wi-Fi Package", "Specialty Dining (3 nights)", "Gratuities Included", "Shore Excursion Credit"]); return { value: `Free ${perk}`, details: { included_perks: [perk] } }; } },
  { type: "reduced_deposit", weight: 8, gen: () => { const d = pick([49, 99, 100, 149]); return { value: `$${d} reduced deposit`, details: { deposit_amount: d, standard_deposit: 500 } }; } },
  { type: "upgrade", weight: 6, gen: () => { const [from, to] = pick([["Interior", "Ocean View"], ["Ocean View", "Balcony"], ["Balcony", "Concierge"]] as const); return { value: `Free ${from} to ${to} upgrade`, details: { upgrade_from: from, upgrade_to: to } }; } },
  { type: "companion_discount", weight: 7, gen: () => { const p = pick([50, 60, 75, 100]); return { value: p === 100 ? "2nd guest sails free" : `2nd guest ${p}% off`, details: { discount_percent: p, applies_to: "second_guest" } }; } },
  { type: "bundle", weight: 5, gen: () => ({ value: "All-Inclusive Package: drinks, Wi-Fi & gratuities", details: { included_perks: ["Classic Drinks Package", "Wi-Fi Package", "Gratuities Included"] } }) },
  { type: "loyalty_bonus", weight: 4, gen: () => { const m = pick([2, 3]); return { value: `${m}x loyalty points`, details: { points_multiplier: m } }; } },
  { type: "group_rate", weight: 3, gen: () => ({ value: "Group rate: book 8+ cabins, 1 free berth per 16", details: { min_cabins: 8, free_berth_ratio: 16 } }) },
  { type: "flash_sale", weight: 5, gen: () => { const p = pick([25, 30, 35, 40]); return { value: `${p}% off — 48 hours only`, details: { discount_percent: p, flash: true } }; } },
];

function pickOfferType(): { type: string; value: string; details: Record<string, unknown> } {
  const total = OFFER_GENERATORS.reduce((s, o) => s + o.weight, 0);
  let r = rand() * total;
  for (const o of OFFER_GENERATORS) {
    r -= o.weight;
    if (r <= 0) {
      const g = o.gen();
      return { type: o.type, value: g.value, details: g.details };
    }
  }
  const last = OFFER_GENERATORS[0];
  const g = last.gen();
  return { type: last.type, value: g.value, details: g.details };
}

const SEASONAL_NAMES = [
  "Wave Season Kickoff {y}", "Spring Sale {y}", "Summer Sizzle Sale {y}", "Fall Into Savings {y}",
  "Black Friday {y}", "Cyber Monday Cruise Deals {y}", "Holiday Gift of Travel {y}", "New Year New Voyage {y}",
  "Presidents Day Sale {y}", "Memorial Day Blowout {y}", "Labor Day Weekend Sale {y}", "4th of July Celebration Sale {y}",
];
const REGIONAL_NAMES = [
  "Alaska Early Bird {y}", "Alaska Last Frontier Sale {y}", "Mediterranean Flash Sale {y}", "Caribbean Winter Warm-Up {y}",
  "Europe Summer Preview {y}", "Bermuda Breeze Sale {y}", "Bahamas Quick Escape {y}", "Hawaii Aloha Days {y}",
  "Panama Canal Passage Sale {y}", "Down Under Deals {y}", "Asia Explorer Sale {y}", "South America Adventure Days {y}",
];
const TARGETED_NAMES = [
  "Welcome Back Offer {y}", "Loyalty Appreciation {y}", "Military Appreciation Month {y}", "Suite Life Upgrade Event {y}",
  "Florida Resident Rates {y}", "Texas & Gulf Resident Sale {y}", "New to Cruise Welcome {y}", "55+ Explorer Savings {y}",
];
const CLEARANCE_NAMES = [
  "Last Cabins: Summer {y} Alaska", "Close-In Sailing Savings {y}", "Final Call: Europe {y}", "Clearance: Caribbean {y} Sailings",
];
const PARTNERSHIP_NAMES = [
  "AAA Member Exclusive {y}", "Costco Travel Package {y}", "AARP Member Savings {y}", "Chase Travel Bonus Days {y}",
];

const TAG_POOL = [
  "wave-season", "flash", "loyalty", "resident", "military", "family", "suite", "obc", "drinks", "wifi",
  "alaska", "caribbean", "europe", "last-minute", "early-bird", "partnership", "seasonal", "clearance",
  "high-priority", "q1", "q2", "q3", "q4",
];

const HEADLINES = [
  "Sail more, spend less — limited time only.",
  "Your next adventure just got sweeter.",
  "Book now and unlock exclusive savings.",
  "The sale you've been waiting for is here.",
  "Bigger savings. Better memories.",
  "Escape to paradise for less.",
  "Limited-time offer on unforgettable voyages.",
  "More horizon for your money.",
];

// ---------------------------------------------------------------------------
// Supabase auth users (optional)
// ---------------------------------------------------------------------------
const TEST_USER_PASSWORD = "PromoVault1!";

/**
 * When Supabase credentials are configured, create real auth users for the
 * five test accounts (password: PromoVault1!) and return email → auth user id.
 * Without Supabase (plain Postgres dev), the fixed UUIDs are used instead.
 */
async function ensureAuthUsers(): Promise<Map<string, string>> {
  const ids = new Map(TEST_USERS.map((u) => [u.email, u.id]));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.log("Supabase not configured — seeding profiles without auth users.");
    return ids;
  }

  console.log("Creating Supabase auth users for test accounts…");
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const u of TEST_USERS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: TEST_USER_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    });
    if (data?.user) {
      ids.set(u.email, data.user.id);
    } else if (error) {
      // Already exists from a previous seed run — look it up.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = list?.users.find((x) => x.email === u.email);
      if (existing) ids.set(u.email, existing.id);
      else console.warn(`Could not create or find auth user ${u.email}: ${error.message}`);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 4 });
  const db = drizzle(client, { schema });

  console.log("Clearing existing data…");
  await db.execute(sql`
    TRUNCATE TABLE
      activity_log, promo_performance, promo_audiences, promo_disclaimers,
      promo_voyages, promotions, audience_segments, disclaimers,
      voyages, regions, ships, profiles
    CASCADE
  `);

  // --- profiles ------------------------------------------------------------
  console.log("Seeding profiles…");
  const authIds = await ensureAuthUsers();
  const userId = (email: string) => authIds.get(email)!;
  for (const u of TEST_USERS) {
    await db
      .insert(schema.profiles)
      .values({
        id: userId(u.email),
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        department: u.department,
      })
      .onConflictDoUpdate({
        target: schema.profiles.id,
        set: { fullName: u.fullName, role: u.role, department: u.department },
      });
  }
  const coordinatorIds = TEST_USERS.filter((u) => u.role === "coordinator").map((u) => userId(u.email));
  const managerId = userId(TEST_USERS[1].email);
  const adminId = userId(TEST_USERS[0].email);
  const ownerPool = [...coordinatorIds, managerId];
  const actorPool = [...coordinatorIds, managerId, adminId];

  // --- ships ---------------------------------------------------------------
  console.log("Seeding ships…");
  const shipRows = SHIPS.map((s) => ({
    id: seededUuid(),
    name: s.name,
    brand: s.brand,
    shipClass: s.ship_class,
    capacityGuests: s.capacity_guests,
    yearBuilt: s.year_built,
    homePort: s.home_port,
    status: "active",
    metadata: {
      godmother: pick(["Serena Marlowe", "Dame Ellen Hart", "Capt. Rosa Delgado", "Naomi Osei", "Grace Whitfield"]),
      tonnage_gt: s.capacity_guests * randInt(28, 36),
      crew: Math.round(s.capacity_guests / pick([2.2, 2.4, 2.6])),
      specialty_dining_venues: randInt(4, 11),
    },
  }));
  await db.insert(schema.ships).values(shipRows);

  // --- regions ---------------------------------------------------------------
  console.log("Seeding regions…");
  const regionRows = REGIONS.map((r) => ({
    id: seededUuid(),
    name: r.name,
    code: r.code,
    description: r.description,
  }));
  await db.insert(schema.regions).values(regionRows);
  const regionByCode = new Map(regionRows.map((r) => [r.code, r]));

  // --- voyages ---------------------------------------------------------------
  console.log("Generating voyages…");
  type VoyageRow = typeof schema.voyages.$inferInsert & { id: string };
  const voyageRows: VoyageRow[] = [];
  const usedCodes = new Set<string>();

  for (let i = 0; i < shipRows.length; i++) {
    const ship = shipRows[i];
    const spec = SHIPS[i];
    const plan = planForShip(spec.home_port);
    const classAbbrev = spec.ship_class.slice(0, 3).toUpperCase();

    let cursor = addDays(WINDOW_START, randInt(0, 6));
    while (cursor < WINDOW_END) {
      const month = cursor.getMonth();
      const regionCode = plan(month);
      const profile = REGION_PROFILES[regionCode];
      const region = regionByCode.get(regionCode)!;
      const nights = pick(profile.durations);
      const sail = cursor;
      const ret = addDays(sail, nights);
      if (ret > WINDOW_END) break;

      const code = `${regionCode}${sail.getFullYear()}-${format(sail, "MMdd")}-${classAbbrev}`;
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        const embark = pick(profile.embarkPorts);
        const isPast = ret < TODAY;
        const status = isPast ? "sailed" : chance(0.015) ? "cancelled" : chance(0.06) ? "closed" : "open";
        const occupancy = isPast || sail <= TODAY ? randInt(40, 98) : randInt(15, 75);
        const portCount = Math.min(profile.ports.length, Math.max(2, Math.round(nights * 0.6)));
        const basePriceFloor = 90 + nights * randInt(8, 18);

        voyageRows.push({
          id: seededUuid(),
          voyageCode: code,
          shipId: ship.id,
          regionId: region.id,
          itineraryName: pick(profile.itineraries).replace("{n}", String(nights)),
          sailDate: iso(sail),
          returnDate: iso(ret),
          durationNights: nights,
          embarkPort: embark,
          debarkPort: regionCode === "TRA" || regionCode === "REP" ? pick(profile.embarkPorts.filter((p) => p !== embark)) : embark,
          portsOfCall: pickN(profile.ports, portCount),
          status,
          cabinCategories: ["Interior", "Ocean View", "Balcony", "Suite"].map((cat, ci) => ({
            category: cat,
            description: `${cat} stateroom`,
            base_price: Math.round((basePriceFloor + ci * randInt(40, 90)) * nights / pick([2, 2.2, 2.5])) * 2,
            inventory: Math.round(spec.capacity_guests / 2 * [0.35, 0.25, 0.3, 0.1][ci]),
          })),
          occupancyPercent: String(occupancy),
          metadata: chance(0.25)
            ? { theme: pick(["Food & Wine", "Jazz at Sea", "Wellness Week", "Family Fun", "Comedy Fest", "80s Retro"]), special_events: [pick(["Deck Party", "Chef's Table Gala", "Star Gazing Night", "Poolside Concert"])] }
            : {},
        });
      }
      // Gaps between sailings: turnaround days, charters, drydock windows
      cursor = addDays(ret, chance(0.3) ? randInt(2, 12) : 0);
    }
  }
  console.log(`  ${voyageRows.length} voyages`);
  for (let i = 0; i < voyageRows.length; i += 500) {
    await db.insert(schema.voyages).values(voyageRows.slice(i, i + 500));
  }

  // --- audience segments -----------------------------------------------------
  console.log("Seeding audience segments…");
  const audienceRows = AUDIENCES.map((a) => ({
    id: seededUuid(),
    name: a.name,
    description: a.description,
    criteria: a.criteria,
    estimatedSize: randInt(8, 400) * 1000,
  }));
  await db.insert(schema.audienceSegments).values(audienceRows);

  // --- disclaimers -------------------------------------------------------------
  console.log("Seeding disclaimers…");
  type DisclaimerRow = typeof schema.disclaimers.$inferInsert & { id: string };
  const disclaimerRows: DisclaimerRow[] = DISCLAIMER_TEMPLATES.map((d) => ({
    id: seededUuid(),
    name: d.name,
    disclaimerText: d.text,
    version: randInt(1, 4),
    appliesToOfferTypes: [...d.applies],
    legalApprovedBy: pick(["K. Ramirez, Legal", "T. Osborne, Legal", "J. Chen, Legal Counsel"]),
    legalApprovedAt: addDays(WINDOW_START, randInt(-200, 60)),
    status: "approved",
    effectiveDate: iso(addDays(WINDOW_START, randInt(-200, 0))),
    expiryDate: null,
  }));
  // A couple of draft/retired versions for realism
  disclaimerRows.push(
    {
      id: seededUuid(),
      name: "General Promotional Terms",
      disclaimerText: DISCLAIMER_TEMPLATES[0].text + " Additional restrictions may apply for holiday sailings.",
      version: 5,
      appliesToOfferTypes: [...DISCLAIMER_TEMPLATES[0].applies],
      legalApprovedBy: null,
      legalApprovedAt: null,
      status: "draft",
      effectiveDate: null,
      expiryDate: null,
    },
    {
      id: seededUuid(),
      name: "Legacy OBC Terms (2024)",
      disclaimerText: "Onboard credit is per person, non-transferable, and expires at the end of the voyage. Superseded by the current Onboard Credit Terms.",
      version: 1,
      appliesToOfferTypes: ["onboard_credit"],
      legalApprovedBy: "K. Ramirez, Legal",
      legalApprovedAt: new Date("2024-03-15T00:00:00Z"),
      status: "retired",
      effectiveDate: "2024-03-15",
      expiryDate: "2025-01-15",
    }
  );
  await db.insert(schema.disclaimers).values(disclaimerRows);
  const approvedDisclaimers = disclaimerRows.filter((d) => d.status === "approved");

  // --- promotions --------------------------------------------------------------
  console.log("Generating promotions…");
  const STATUS_PLAN: [string, number][] = [
    ["draft", 10],
    ["pending_rm_data", 5],
    ["pending_voyage_list", 5],
    ["pending_legal", 3],
    ["pending_approval", 5],
    ["approved", 10],
    ["live", 15],
    ["paused", 5],
    ["expired", 152],
    ["cancelled", 10],
  ];

  type PromoRow = typeof schema.promotions.$inferInsert & { id: string };
  const promoRows: PromoRow[] = [];
  const pvRows: (typeof schema.promoVoyages.$inferInsert)[] = [];
  const pdRows: (typeof schema.promoDisclaimers.$inferInsert)[] = [];
  const paRows: (typeof schema.promoAudiences.$inferInsert)[] = [];
  const perfRows: (typeof schema.promoPerformance.$inferInsert)[] = [];
  const logRows: (typeof schema.activityLog.$inferInsert)[] = [];
  const usedPromoCodes = new Set<string>();
  const usedPromoNames = new Set<string>();

  const daysSinceWindowStart = Math.max(60, differenceInCalendarDays(TODAY, WINDOW_START));

  function sellWindowFor(status: string, isFlash: boolean): { start: Date; end: Date } {
    const len = isFlash ? randInt(2, 3) : randInt(5, 45);
    switch (status) {
      case "expired": {
        // Ended somewhere between window start and yesterday
        const end = addDays(WINDOW_START, randInt(len + 1, daysSinceWindowStart - 1));
        return { start: addDays(end, -len), end };
      }
      case "live":
      case "paused": {
        // Spans today
        const start = addDays(TODAY, -randInt(0, Math.max(1, len - 1)));
        return { start, end: addDays(start, len) };
      }
      case "approved": {
        const start = addDays(TODAY, randInt(2, 60));
        return { start, end: addDays(start, len) };
      }
      case "cancelled": {
        // Mostly historical, some future kills
        const start = chance(0.7)
          ? addDays(WINDOW_START, randInt(0, Math.max(1, daysSinceWindowStart - len)))
          : addDays(TODAY, randInt(5, 90));
        return { start, end: addDays(start, len) };
      }
      default: {
        // draft / pending_* — future windows still being built
        const start = addDays(TODAY, randInt(7, 150));
        return { start, end: addDays(start, len) };
      }
    }
  }

  function promoNameFor(source: string, year: number): { name: string; tags: string[] } {
    let pool: string[];
    let tags: string[];
    switch (source) {
      case "partnership":
        pool = PARTNERSHIP_NAMES;
        tags = ["partnership"];
        break;
      case "clearance":
        pool = CLEARANCE_NAMES;
        tags = ["clearance", "last-minute"];
        break;
      case "competitive_response":
        pool = [...REGIONAL_NAMES, ...SEASONAL_NAMES];
        tags = ["competitive"];
        break;
      case "rm_recommendation":
        pool = [...REGIONAL_NAMES, ...CLEARANCE_NAMES, ...TARGETED_NAMES];
        tags = ["rm"];
        break;
      default:
        pool = [...SEASONAL_NAMES, ...REGIONAL_NAMES, ...TARGETED_NAMES];
        tags = ["seasonal"];
    }
    const name = pick(pool).replace("{y}", String(year));
    return { name, tags: [...tags, ...pickN(TAG_POOL, randInt(1, 3))] };
  }

  let codeCounter = 100;
  for (const [status, count] of STATUS_PLAN) {
    for (let i = 0; i < count; i++) {
      const offer = pickOfferType();
      const isFlash = offer.type === "flash_sale";
      const { start: sellStart, end: sellEnd } = sellWindowFor(status, isFlash);
      const source = pick(["rm_recommendation", "competitive_response", "seasonal", "clearance", "partnership"] as const);
      const named = promoNameFor(source, sellStart.getFullYear());
      const tags = named.tags;
      let name = named.name;
      if (usedPromoNames.has(name)) {
        name = `${name} — ${pick(["Extended", "Encore", "Wave 2", "Round 2", "Final Days"])}`;
        if (usedPromoNames.has(name)) name = `${name} (${codeCounter})`;
      }
      usedPromoNames.add(name);

      // Voyage targeting: regional promos pick 1-2 regions, fleetwide pick many
      const fleetwide = chance(0.3);
      const targetRegionIds = fleetwide
        ? null
        : pickN(regionRows, randInt(1, 2)).map((r) => r.id);

      // Voyages must sail after the sell window opens (typically after sell start)
      const sailFloor = addDays(sellStart, randInt(0, 20));
      const sailCeiling = addDays(sellEnd, randInt(120, 540));
      const eligible = voyageRows.filter((v) => {
        const sd = new Date(v.sailDate + "T00:00:00");
        if (sd < sailFloor || sd > sailCeiling) return false;
        if (targetRegionIds && !targetRegionIds.includes(v.regionId!)) return false;
        return v.status !== "cancelled";
      });
      // pending_voyage_list promos intentionally have few/no voyages yet
      const linkTarget =
        status === "pending_voyage_list" || status === "pending_rm_data"
          ? randInt(0, 10)
          : Math.min(eligible.length, randInt(20, 200));
      const linked = pickN(eligible, linkTarget);

      const promoId = seededUuid();
      const promoCode = chance(0.85)
        ? `${name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 3).map((w) => w[0]).join("").toUpperCase()}${format(sellStart, "yyMM")}${codeCounter++}`
        : null;
      if (promoCode) {
        if (usedPromoCodes.has(promoCode)) continue;
        usedPromoCodes.add(promoCode);
      }

      const ownerId = pick(ownerPool);
      const approved = ["approved", "live", "paused", "expired"].includes(status);
      const sailStart = chance(0.6) ? iso(sailFloor) : null;
      const sailEnd = sailStart && chance(0.7) ? iso(sailCeiling) : null;
      const markets = pick([["NA"], ["NA", "UK"], ["NA", "UK", "AU"], ["Global"], ["UK", "EU"], ["NA", "LATAM"]] as const);
      const channels = pick([["direct", "ta"], ["direct", "ta", "ota"], ["direct"], ["ta", "group"], ["direct", "ta", "ota", "loyalty"]] as const);

      const createdAt = addDays(sellStart, -randInt(10, 90));
      const approvedAt = approved ? addDays(sellStart, -randInt(1, 9)) : null;

      promoRows.push({
        id: promoId,
        promoName: name,
        promoCode,
        description: `${name}: ${offer.value} on ${fleetwide ? "select sailings fleetwide" : "select regional sailings"}. Sourced from ${source.replace(/_/g, " ")}.`,
        offerType: offer.type,
        offerValue: offer.value,
        offerDetails: { ...offer.details, combinable_with: chance(0.3) ? ["loyalty_bonus"] : [] },
        sellStartDate: iso(sellStart),
        sellEndDate: iso(sellEnd),
        sailStartDate: sailStart,
        sailEndDate: sailEnd,
        market: [...markets],
        bookingChannels: [...channels],
        isCombinable: chance(0.35),
        status,
        ownerId,
        approvedBy: approved ? managerId : null,
        approvedAt,
        source,
        priority: pick(["critical", "high", "normal", "normal", "normal", "low"] as const),
        notes: chance(0.5)
          ? pick([
              "RM flagged soft demand on shoulder-season departures; monitor weekly pickup.",
              "Legal reviewed combinability language 2 cycles ago — reuse approved wording.",
              "Coordinate launch email with CRM team before go-live.",
              "Follow-up: confirm TA portal copy before distribution.",
              "Pricing matrix stored in RM shared drive; snapshot attached to brief.",
              "Extension considered if pickup < 60% of target by mid-window.",
            ])
          : null,
        tags,
        headline: pick(HEADLINES),
        termsSummary: `${offer.value}. Applies to new bookings made ${iso(sellStart)} through ${iso(sellEnd)}. Capacity controlled; other restrictions apply.`,
        content: {
          web: { title: name, body: `${pick(HEADLINES)} ${offer.value} on select sailings.`, cta: "Book Now" },
          email: { subject: `${name}: ${offer.value}`, body: `Don't miss ${name.toLowerCase()} — ${offer.value} for a limited time.` },
          ta_portal: { description: `${name} — ${offer.value}. See terms for combinability and deposit rules.` },
        },
        createdAt,
        updatedAt: approvedAt ?? createdAt,
      });

      for (const v of linked) {
        pvRows.push({
          id: seededUuid(),
          promoId,
          voyageId: v.id,
          overrideOfferValue: chance(0.04) ? `${offer.value} + $50 bonus OBC` : null,
          overrideDetails: null,
          addedBy: ownerId,
          addedAt: addDays(createdAt, randInt(0, 6)),
        });
      }

      // Disclaimers: prefer ones covering this offer type
      const matching = approvedDisclaimers.filter((d) => d.appliesToOfferTypes?.includes(offer.type));
      const chosenDisclaimers = pickN(
        matching.length > 0 ? matching : approvedDisclaimers,
        status === "pending_legal" ? 0 : randInt(1, 3)
      );
      for (const d of chosenDisclaimers) {
        pdRows.push({ id: seededUuid(), promoId, disclaimerId: d.id });
      }

      for (const a of pickN(audienceRows, randInt(1, 3))) {
        paRows.push({ id: seededUuid(), promoId, segmentId: a.id });
      }

      // Performance for expired + live (and paused, which ran for a while)
      if (["expired", "live", "paused"].includes(status)) {
        const scale = Math.max(1, linked.length) / 200;
        const totalBookings = Math.round(randInt(50, 5000) * Math.max(0.15, scale));
        const avgValue = randInt(1800, 4200);
        const perfEnd = minDate([sellEnd, TODAY]);
        let periodCursor = startOfMonth(sellStart);
        const periods: { start: Date; end: Date }[] = [];
        while (periodCursor <= perfEnd) {
          periods.push({
            start: periodCursor < sellStart ? sellStart : periodCursor,
            end: minDate([endOfMonth(periodCursor), perfEnd]),
          });
          periodCursor = startOfMonth(addMonths(periodCursor, 1));
        }
        const nPeriods = Math.max(1, periods.length);
        for (const p of periods) {
          const bookings = Math.max(5, Math.round((totalBookings / nPeriods) * (0.6 + rand() * 0.8)));
          const revenue = bookings * avgValue * (0.9 + rand() * 0.2);
          perfRows.push({
            id: seededUuid(),
            promoId,
            voyageId: null,
            periodStart: iso(p.start),
            periodEnd: iso(p.end),
            bookings,
            revenue: revenue.toFixed(2),
            redemptions: Math.round(bookings * (0.7 + rand() * 0.25)),
            cancellations: Math.round(bookings * (0.05 + rand() * 0.15)),
            avgBookingValue: (revenue / bookings).toFixed(2),
            incrementalBookings: Math.round(bookings * (0.1 + rand() * 0.3)),
            recordedAt: addDays(p.end, randInt(1, 5)),
          });
        }
        // A few voyage-level breakdowns for the biggest promos
        if (linked.length >= 50 && chance(0.4)) {
          for (const v of pickN(linked, randInt(3, 8))) {
            const b = randInt(10, 220);
            const rev = b * avgValue * (0.85 + rand() * 0.3);
            perfRows.push({
              id: seededUuid(),
              promoId,
              voyageId: v.id,
              periodStart: iso(sellStart),
              periodEnd: iso(perfEnd),
              bookings: b,
              revenue: rev.toFixed(2),
              redemptions: Math.round(b * (0.7 + rand() * 0.25)),
              cancellations: Math.round(b * (0.05 + rand() * 0.15)),
              avgBookingValue: (rev / b).toFixed(2),
              incrementalBookings: Math.round(b * (0.1 + rand() * 0.3)),
              recordedAt: addDays(perfEnd, randInt(1, 5)),
            });
          }
        }
      }

      // Activity log lifecycle
      let logTime = createdAt;
      const pushLog = (action: string, changes: Record<string, { old: unknown; new: unknown }> | null, by?: string) => {
        logRows.push({
          id: seededUuid(),
          entityType: "promotion",
          entityId: promoId,
          action,
          changes,
          performedBy: by ?? ownerId,
          performedAt: logTime,
        });
        logTime = addDays(logTime, randInt(0, 4));
      };

      pushLog("created", { status: { old: null, new: "draft" } });
      if (chance(0.6)) pushLog("updated", { offer_value: { old: "TBD", new: offer.value } });
      if (linked.length > 0) pushLog("voyages_linked", { voyage_count: { old: 0, new: linked.length } });

      const path: Record<string, string[]> = {
        draft: [],
        pending_rm_data: ["pending_rm_data"],
        pending_voyage_list: ["pending_rm_data", "pending_voyage_list"],
        pending_legal: ["pending_voyage_list", "pending_legal"],
        pending_approval: ["pending_voyage_list", "pending_legal", "pending_approval"],
        approved: ["pending_approval", "approved"],
        live: ["pending_approval", "approved", "live"],
        paused: ["pending_approval", "approved", "live", "paused"],
        expired: ["pending_approval", "approved", "live", "expired"],
        cancelled: chance(0.5) ? ["cancelled"] : ["pending_approval", "cancelled"],
      };
      let prev = "draft";
      for (const s of path[status] ?? []) {
        const by = ["approved", "live"].includes(s) ? managerId : pick(actorPool);
        pushLog(s === "approved" ? "approved" : "status_changed", { status: { old: prev, new: s } }, by);
        prev = s;
      }
    }
  }

  console.log(`  ${promoRows.length} promotions, ${pvRows.length} voyage links`);
  for (let i = 0; i < promoRows.length; i += 200) {
    await db.insert(schema.promotions).values(promoRows.slice(i, i + 200));
  }
  for (let i = 0; i < pvRows.length; i += 1000) {
    await db.insert(schema.promoVoyages).values(pvRows.slice(i, i + 1000));
  }
  await db.insert(schema.promoDisclaimers).values(pdRows);
  await db.insert(schema.promoAudiences).values(paRows);
  console.log(`  ${perfRows.length} performance rows`);
  for (let i = 0; i < perfRows.length; i += 500) {
    await db.insert(schema.promoPerformance).values(perfRows.slice(i, i + 500));
  }
  console.log(`  ${logRows.length} activity log rows`);
  for (let i = 0; i < logRows.length; i += 500) {
    await db.insert(schema.activityLog).values(logRows.slice(i, i + 500));
  }

  // --- summary -----------------------------------------------------------------
  const counts = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM ships) AS ships,
      (SELECT count(*) FROM regions) AS regions,
      (SELECT count(*) FROM voyages) AS voyages,
      (SELECT count(*) FROM promotions) AS promotions,
      (SELECT count(*) FROM promo_voyages) AS promo_voyages,
      (SELECT count(*) FROM disclaimers) AS disclaimers,
      (SELECT count(*) FROM audience_segments) AS audiences,
      (SELECT count(*) FROM promo_performance) AS performance,
      (SELECT count(*) FROM activity_log) AS activity,
      (SELECT count(*) FROM profiles) AS profiles
  `);
  console.log("Seed complete:", counts[0] ?? counts);

  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
