/**
 * Rule-based advisor used when Gemini is unavailable or has no API key.
 *
 * Content is table-driven: the smog/clean branches hold the routine copy, and
 * small factories only interpolate live values (AQI, cleanest hours, profile).
 */

"use strict";

const { INDOOR_HEPA_REDUCTION_PCT } = require("./core");

const SMOG_AQI_THRESHOLD = 101;

/** Build a plan item; `why` is optional and only used by indoor-air hacks. */
const action = (title, detail, impact, why) => (why ? { title, detail, impact, why } : { title, detail, impact });

const INDOOR_AIR_HACKS = [
  action("Run HEPA on smog days",
    "A true HEPA-13 unit with a sealed box cuts PM2.5 by up to 90%.",
    "Up to 90% PM2.5 reduction in the main room",
    "HEPA traps fine particles that reach the lungs — the exact pollutant smog is made of."),
  action("Recirculate, don't ventilate (smog days)",
    "Keep windows closed; let AC/purifier recirculate.",
    "Stops up to 80% of outdoor smog entering the home",
    "Indoor-outdoor PM2.5 exchange is the biggest indoor exposure driver on smog days."),
  action("Vented range hood while cooking",
    "Use the exhaust fan; avoid deep-frying.",
    "Cuts indoor grease-fume PM by ~30-50%",
    "Cooking fumes are a top residential PM2.5 source, second only to smog infiltration."),
  action("No-smoke, no incense policy",
    "Keep the home smoke- and incense-free; air-dry clothes instead of drying at the stove.",
    "Eliminates an indoor particulate source",
    "These add PM2.5 that stacks with smog infiltration."),
  action("Seal gaps, warm efficiently",
    "Draft-seal around windows; use a timer on heating.",
    "~0.4 kg CO₂/day + tighter home air",
    "Tighter envelope means purifier/AC work more effectively and use less energy."),
];

const SENSITIVE_NOTES = {
  smog: [
    "For the kids and any family member with asthma/COPD: keep the purifier running in their bedroom overnight; avoid all outdoor exertion in smog-hour windows.",
    "Elderly members: limit time outdoors when AQI ≥ 150; a short, brisk errand in the low-PM2.5 window is fine.",
    "Run the purifier on the highest setting for the first 30 minutes of the smog window so rooms drop to a healthier PM2.5 baseline faster.",
  ],
  clean: [
    "Even on good-AQI days, keep one purifier running 24/7 as a buffer for the winter smog season.",
    "Kitchen: use the range hood even on light cooking to prevent indoor PM build-up.",
  ],
};

function smogRoutine(ctx) {
  const cleanest = ctx.liveAqi.bestWindows[0]?.hour || "mid-morning";
  const worksFromHome = ctx.work === "home" || ctx.work.toLowerCase().includes("home");
  return {
    am: [
      action("Plan your day around the air",
        `Check the 24h AQI curve; the lowest-PM2.5 window today is ${cleanest}.`,
        "Keeps your whole family's inhalation exposure down during the worst smog hours."),
      action("Prep an N95 mask + check home HVAC",
        "Gather N95/FITTED masks for the commute; set the home AC to recirculate mode so you're not drawing in smog.",
        "N95s filter ~95% of PM2.5; recirculating stops ~80% of outdoor smog entering the home."),
      action("Breakfast: plant-forward",
        "Make a veg-heavy breakfast; skip frying and use low-heat cooking.",
        "Cuts cooking fumes (an indoor PM2.5 source) and ~0.5 kg CO₂e."),
    ],
    day: [
      action("Commute low-emission",
        `Your commute is ${ctx.commute}. On a smog day, ${worksFromHome ? "work from home if possible" : "shift to transit/e-bike/walk if the route allows"}.`,
        "Avoids ~7-9.5 kg CO₂/day and keeps you out of the worst particulate layer."),
      action("Indoor air lock-down",
        "Close windows on the smog side; run HEPA in the main room; use an air purifier on the auto/smog setting.",
        "HEPA cuts indoor PM2.5 by up to 90% in 1-2 hours on a smog day."),
      action("Low-impact workout indoors",
        "Do a bodyweight / yoga session instead of running outdoors.",
        "Zero smog inhalation; stays just as effective for cardio."),
    ],
    pm: [
      action("Air-purify while cooking",
        "Run the purifier and range hood (vented outside) during dinner; air-fry rather than deep-fry.",
        "Range hood + HEPA keep kitchen PM2.5 and grease-fume spikes down."),
      action("Seal drafts, warm efficiently",
        "Close unused rooms, seal window gaps; keep heating on a timer.",
        "Cuts heating CO₂ ~0.4 kg/day and stops cold + smog infiltration."),
      action("Track & log exposure",
        "Note the AQI when you arrived home; plan tomorrow's low-emissions window from the 24h forecast.",
        "Builds a family routine that automatically avoids smog days."),
    ],
  };
}

function cleanRoutine(ctx) {
  const activeCommute = ctx.commute.includes("walk") || ctx.commute.includes("bike");
  const cleanest = ctx.liveAqi.bestWindows[0]?.hour || "mid-morning";
  return {
    am: [
      action("Morning low-carbon move",
        `AQI is ${ctx.aqiMeta.name} (${ctx.liveAqi.aqi}). ${activeCommute ? "Enjoy the walk/ride." : "Swap today's car trip for the bike lane or a brisk walk."}`,
        "Zero tailpipe exposure; ~9 kg CO₂/day avoided vs car."),
      action("Fresh-air ventilation window",
        "With good air, open windows for 10-15 min to flush indoor CO₂ and VOCs before they build up.",
        "Improves indoor air and cognitive performance without letting in smog."),
      action("Plant-based breakfast",
        "Eggs + oats + veg; skip the fried option today.",
        "~1.2 kg CO₂e/day avoided."),
    ],
    day: [
      action("Use the low-PM2.5 window",
        `Best window today is ${cleanest} for any outdoor time.`,
        "Schedules exercise and errands into the cleanest air of the day."),
      action("E-bike / transit for errands",
        "Bundle errands into one trip; use the bike or transit instead of the car.",
        "~7 kg CO₂/day + zero smog inhalation."),
      action("Keep HEPA on low",
        "Run the air purifier on low/auto for background filtration.",
        "Maintains ~20-40% lower indoor PM2.5 with minimal energy."),
    ],
    pm: [
      action("Evening air-out",
        "Circulate with windows open for 5-10 min as the day's VOCs clear.",
        "Fresh air, no smog penalty while AQI is good."),
      action("Cold laundry + air-dry",
        "Wash cold; hang-dry outside if humidity allows.",
        "~0.8 kg CO₂ + no dryer emissions."),
      action("Lighting check",
        "Switch to LED in rooms in use; turn off idle rooms.",
        "~0.6 kg CO₂/day + less heat load."),
    ],
  };
}

function sustainabilitySwaps(ctx) {
  return [
    action("Swap car -> bike/transit on smog days",
      `Your ${ctx.commute} commute. Use transit or the e-bike when AQI is Unhealthy+.`,
      "~7-9.5 kg CO₂/day avoided"),
    action("Two plant-forward meals daily",
      "Veg or grain-based breakfast + dinner.",
      "~2.4 kg CO₂e/day avoided"),
    action("Cold wash + air-dry",
      "Default to cold laundry; air-dry on smog days.",
      "~0.8 kg CO₂/day + zero dryer fumes"),
    action("LED + timed heating",
      "Full LED; heating on a timer; seal drafts.",
      "~1.0 kg CO₂/day saved"),
    action("Bulk / reusable shopping",
      "Reusable containers; buy in bulk; refill stations where possible.",
      "Cuts packaging waste + the CO₂ of producing single-use plastics"),
  ];
}

/**
 * Produce a complete, practical plan without any network or API key.
 * @param {object} ctx live AQI, weather and lifestyle profile
 */
function offlineAdvisor(ctx) {
  const smog = ctx.liveAqi.aqi >= SMOG_AQI_THRESHOLD;
  const nextWindow = ctx.liveAqi.bestWindows[1]?.hour || "later in the day";

  return {
    headline: smog
      ? `Severe smog today (AQI ${ctx.liveAqi.aqi}). A low-emissions day + indoor air lock-down keeps your family protected.`
      : `Good air today (AQI ${ctx.liveAqi.aqi}). Lock in low-carbon habits while it lasts; prep for the winter smog season.`,
    routine: smog ? smogRoutine(ctx) : cleanRoutine(ctx),
    indoorAir: INDOOR_AIR_HACKS,
    sustainability: sustainabilitySwaps(ctx),
    // Numeric fields are filled by buildImpactSummary in the route. Here we
    // only provide the qualitative explanations tailored to this advisor.
    impactSummary: {
      localAQIBenefit: "Replacing car trips and high-heat cooking removes your household's own share of local PM2.5 precursors — a small but real cut in the neighbourhood source term over a sustained week.",
      indoorAirBenefit: `Combined HEPA + recirculation + no-smoking can keep indoor PM2.5 roughly ${INDOOR_HEPA_REDUCTION_PCT}% lower than the outdoor level on smog days (typical well-sealed purifier performance, not a guarantee).`,
    },
    sensitiveNotes: smog ? SENSITIVE_NOTES.smog : SENSITIVE_NOTES.clean,
    nextCheck: `Re-check the 24h forecast each morning. The next low-PM2.5 window today is ${nextWindow} — schedule outdoor time around it.`,
  };
}

module.exports = { offlineAdvisor, smogRoutine, cleanRoutine, SMOG_AQI_THRESHOLD };
