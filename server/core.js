/**
 * AURA core — pure, dependency-free domain logic.
 *
 * Kept separate from the HTTP/network layer so every rule can be unit-tested
 * with `node --test` without starting a server or calling a live API.
 *
 * Contents:
 *   - region-aware AQI standards (India CPCB, US EPA, labelled EPA reference)
 *   - deterministic environmental-impact math
 *   - untrusted-input normalisation / validation
 *   - geocoding result ranking
 */

"use strict";

/* ------------------------------------------------------------------ *
 * AQI standards
 * ------------------------------------------------------------------ */

const EPA_LEVELS = [
  { name: "Good", min: 0, max: 50, color: "#16a34a", bg: "rgba(22,163,74,.12)" },
  { name: "Moderate", min: 51, max: 100, color: "#ca8a04", bg: "rgba(202,138,4,.14)" },
  { name: "Unhealthy", min: 101, max: 150, color: "#ea580c", bg: "rgba(234,88,12,.14)" },
  { name: "Very Unhealthy", min: 151, max: 200, color: "#dc2626", bg: "rgba(220,38,38,.14)" },
  { name: "Hazardous", min: 201, max: 500, color: "#7f1d1d", bg: "rgba(127,29,29,.18)" },
];

const INDIA_LEVELS = [
  { name: "Good", min: 0, max: 50, color: "#16a34a", bg: "rgba(22,163,74,.12)" },
  { name: "Satisfactory", min: 51, max: 100, color: "#65a30d", bg: "rgba(101,163,13,.14)" },
  { name: "Moderate", min: 101, max: 200, color: "#eab308", bg: "rgba(234,179,8,.14)" },
  { name: "Poor", min: 201, max: 300, color: "#f97316", bg: "rgba(249,115,22,.14)" },
  { name: "Very Poor", min: 301, max: 400, color: "#dc2626", bg: "rgba(220,38,38,.14)" },
  { name: "Severe", min: 401, max: 500, color: "#7f1d1d", bg: "rgba(127,29,29,.18)" },
];

// Concentration -> sub-index break points (piecewise linear).
const EPA_BP = {
  pm2_5: [[0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500.4, 301, 500]],
  pm10: [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150],
    [255, 354, 151, 200], [355, 424, 201, 300], [425, 600, 301, 500]],
  ozone: [[0, 54, 0, 50], [55, 70, 51, 100], [71, 85, 101, 150],
    [86, 105, 151, 200], [106, 200, 201, 300], [201, 404, 301, 500]],
  nitrogen_dioxide: [[0, 100, 0, 50], [101, 360, 51, 100], [361, 649, 101, 150],
    [650, 1300, 151, 200], [1301, 2100, 201, 300], [2101, 4000, 301, 500]],
  // EPA CO break points are in mg/m³.
  carbon_monoxide: [[0, 4.4, 0, 50], [4.5, 9.4, 51, 100], [9.5, 12.4, 101, 150],
    [12.5, 15.4, 151, 200], [15.5, 30.9, 201, 300], [31.0, 50.4, 301, 500]],
};

const INDIA_BP = {
  pm2_5: [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200],
    [91, 120, 201, 300], [121, 250, 301, 400], [250.1, 500, 401, 500]],
  pm10: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200],
    [251, 350, 201, 300], [351, 430, 301, 400], [430.1, 600, 401, 500]],
  ozone: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 168, 101, 200],
    [169, 208, 201, 300], [209, 748, 301, 400], [748.1, 1000, 401, 500]],
  nitrogen_dioxide: [[0, 40, 0, 50], [41, 80, 51, 100], [85, 180, 101, 200],
    [181, 280, 201, 300], [281, 400, 301, 400], [400.1, 1000, 401, 500]],
  // CPCB CO break points are in mg/m³.
  carbon_monoxide: [[0, 1, 0, 50], [1.1, 2, 51, 100], [2.1, 10, 101, 200],
    [10.1, 17, 201, 300], [17.1, 34, 301, 400], [34.1, 60, 401, 500]],
};

/** Pick the official AQI standard from a geocoded country. */
function aqiStandardFor(country) {
  const c = String(country || "").toLowerCase();
  if (c.includes("india")) return "in";
  if (c.includes("united states") || c === "us" || c === "usa") return "us";
  return "epa";
}

function standardMeta(std) {
  if (std === "in") return { id: "in", label: "India AQI (CPCB)", short: "India AQI", levels: INDIA_LEVELS };
  if (std === "us") return { id: "us", label: "US AQI (EPA)", short: "US AQI", levels: EPA_LEVELS };
  return { id: "epa", label: "AQI · US EPA reference scale", short: "AQI (EPA scale)", levels: EPA_LEVELS };
}

/**
 * Convert a pollutant concentration into an AQI sub-index.
 *
 * Official tables print ranges such as 41–80 then 85–180, leaving apparent
 * "gaps" at 81–84. Those are rounding artefacts, not missing air: a value in a
 * gap belongs to the next bucket. This implementation uses each bucket's upper
 * bound and the previous bucket's upper bound as the lower bound, so no reading
 * can ever fall through and be mis-reported as 500.
 */
function aqiFor(level, value, std) {
  const table = std === "in" ? INDIA_BP : EPA_BP;
  const breakpoints = table[level] || table.pm2_5;
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return 0;
  for (let i = 0; i < breakpoints.length; i++) {
    const [c1, upper, a1, a2] = breakpoints[i];
    if (v <= upper) {
      // Inside the published range use its own lower bound; only readings in a
      // rounding gap borrow the previous upper bound.
      const lower = v < c1 ? (i === 0 ? c1 : breakpoints[i - 1][1]) : c1;
      const concentration = Math.min(Math.max(v, lower), upper);
      return Math.round(a1 + (a2 - a1) * ((concentration - lower) / (upper - lower)));
    }
  }
  return 500; // genuinely out-of-range clamp
}

/** Category, colours and legend for an AQI value under a given standard. */
function aqiMeta(aqi, std) {
  const meta = standardMeta(std);
  const value = Math.min(Math.max(Number(aqi) || 0, 0), 500);
  const level = meta.levels.find((l) => value >= l.min && value <= l.max) || meta.levels[meta.levels.length - 1];
  return {
    aqi: value,
    ...level,
    standard: meta.id,
    standardLabel: meta.label,
    shortLabel: meta.short,
    scale: meta.levels.map((l) => ({ name: l.name, color: l.color, min: l.min, max: l.max })),
  };
}

/** Open-Meteo reports CO in µg/m³; AQI break points use mg/m³. */
function ugM3ToMgM3(value) {
  return value == null ? null : Number(value) / 1000;
}

/* ------------------------------------------------------------------ *
 * Deterministic impact math
 * ------------------------------------------------------------------ */

const IMPACT_FACTORS = Object.freeze({
  car_to_walk: 10.4,
  car_to_transit: 7.2,
  car_to_ebike: 9.0,
  homeoffice: 9.5,
  meat_day: 1.2,
  meat_week: 8.4,
  cold_wash: 0.8,
  led_swap: 0.6,
  insulation: 0.4,
  bulk_no_plastic: 0.3,
  recycling: 0.2,
});

const KG_CO2_PER_TREE_YEAR = 21;
const DAYS_PER_YEAR = 365;

// Typical well-sealed portable HEPA-13 cleaner performance in a single room.
// Illustrative, not a guarantee — surfaced in the UI with that qualification.
const INDOOR_HEPA_REDUCTION_PCT = 70;

// Ordered rules: the first matching category wins. Factors come from one table.
const IMPACT_RULES = [
  { id: "active_commute", pattern: /walk|bik|cycl|ebike/, saved: IMPACT_FACTORS.car_to_ebike,
    reason: "Walking / e-biking your main trip instead of a petrol car (~5 km) avoids ~9 kg CO₂/day" },
  { id: "public_transit", pattern: /transit|bus|metro|rail|public/, saved: IMPACT_FACTORS.car_to_transit,
    reason: "Public transit avoids ~7 kg CO₂/day per commuter vs a solo car trip" },
  // Deliberately specific: a generic "green office" tip is not a commute swap.
  { id: "remote_work", pattern: /work from home|work-from-home|remote work|homeoffice|wfh/, saved: IMPACT_FACTORS.homeoffice,
    reason: "Working from home skips a car commute, ~9.5 kg CO₂/day and keeps you indoors during the worst smog" },
  { id: "plant_based", pattern: /meat|plant|vegetarian/, saved: IMPACT_FACTORS.meat_day,
    reason: "One plant-based meal/day avoids ~1.2 kg CO₂e" },
  { id: "cold_laundry", pattern: /cold|laundry|wash/, saved: IMPACT_FACTORS.cold_wash,
    reason: "Cold laundry + air-drying saves ~0.8 kg CO₂ and avoids detergent fumes indoors" },
  { id: "led_lighting", pattern: /led|light|bulb/, saved: IMPACT_FACTORS.led_swap,
    reason: "Swapping to LED + turning off unused rooms saves ~0.6 kg CO₂ and cuts heat load" },
  { id: "draft_sealing", pattern: /insulat|draft|seal/, saved: IMPACT_FACTORS.insulation,
    reason: "Sealing drafts cuts heating demand ~0.4 kg CO₂/day and improves indoor air retention" },
  { id: "recycling", pattern: /recycl|compost/, saved: IMPACT_FACTORS.recycling,
    reason: "Composting + recycling avoids landfill methane, ~0.2 kg CO₂e" },
  { id: "reuse", pattern: /bulk|plastic|reuse/, saved: IMPACT_FACTORS.bulk_no_plastic,
    reason: "Reusable containers / bulk buying avoid single-use plastic production" },
];

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Translate low-emission actions into tangible household numbers.
 *
 * Each category is counted ONCE even if the same habit appears in the morning,
 * daytime and evening sections — otherwise the dashboard would triple-count a
 * single commute swap. Fully deterministic and auditable.
 */
function buildImpact(activities) {
  const details = [];
  const seen = new Set();
  for (const act of activities || []) {
    const key = String((act && (act.action || act.key)) || "").toLowerCase();
    const rule = IMPACT_RULES.find((candidate) => candidate.pattern.test(key));
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    details.push({ action: rule.id, saved: round1(rule.saved), reason: rule.reason });
  }
  const dailyCO2 = details.reduce((sum, d) => sum + d.saved, 0);
  const annual = dailyCO2 * DAYS_PER_YEAR;
  return {
    dailyKgCO2: round1(dailyCO2),
    annualKgCO2: round1(annual),
    treesEquivalent: round1(annual / KG_CO2_PER_TREE_YEAR),
    indoorHEPAReductionPct: INDOOR_HEPA_REDUCTION_PCT,
    details,
  };
}

/* ------------------------------------------------------------------ *
 * Untrusted input handling
 * ------------------------------------------------------------------ */

const FIELD_LIMITS = Object.freeze({
  locationName: 80,
  timezone: 64,
  commute: 40,
  work: 40,
  household: 60,
  diet: 60,
  energy: 60,
  family: 120,
});

/** Strip control characters, collapse whitespace and cap length. */
function cleanText(value, maxLength) {
  if (value == null) return "";
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Parse a latitude/longitude without accepting strings such as "1e999". */
function parseCoordinate(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Validate and normalise the POST /api/plan body before it reaches the LLM. */
function validateProfile(body) {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const profile = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    profile[key] = cleanText(raw[key], limit);
  }

  const lat = parseCoordinate(raw.lat);
  const lon = parseCoordinate(raw.lon);
  profile.lat = lat !== null && lat >= -90 && lat <= 90 ? lat : null;
  profile.lon = lon !== null && lon >= -180 && lon <= 180 ? lon : null;

  // A valid IANA zone or the literal "auto"; anything else is dropped.
  const zone = profile.timezone;
  profile.timezone = zone === "auto" || /^[A-Za-z_+\-/]{1,64}$/.test(zone) ? zone : "auto";

  if (!profile.locationName && (profile.lat === null || profile.lon === null)) {
    return { error: "Provide a city name (or a valid lat/lon pair)." };
  }
  return { profile };
}

/* ------------------------------------------------------------------ *
 * Geocoding
 * ------------------------------------------------------------------ */

/** Rank major administrative cities first so "Delhi" resolves to Delhi, India. */
function rankGeocodeResults(results) {
  const score = (r) => (r && r.feature_code === "PPLA" ? 1e15 + (r.population || 0) : (r.population || 0));
  return (results || []).slice().sort((a, b) => score(b) - score(a));
}

module.exports = {
  // AQI
  EPA_LEVELS, INDIA_LEVELS, EPA_BP, INDIA_BP,
  aqiStandardFor, standardMeta, aqiFor, aqiMeta, ugM3ToMgM3,
  // impact
  IMPACT_FACTORS, IMPACT_RULES, buildImpact, INDOOR_HEPA_REDUCTION_PCT,
  // validation
  cleanText, parseCoordinate, validateProfile,
  // geocoding
  rankGeocodeResults,
};
