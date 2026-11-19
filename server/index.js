/**
 * AURA — Air Quality GenAI Assistant for Families & Communities.
 *
 * HTTP composition root. Domain rules, network adapters and generation live in
 * focused sibling modules; this file only wires middleware and routes together.
 *
 * Pipeline: typed city + lifestyle -> live AQI/weather -> Gemini plan (or
 * offline advisor) -> locally computed impact -> JSON response for the UI.
 */

"use strict";

const express = require("express");
const path = require("path");
const config = require("./config");
const { aqiStandardFor, aqiMeta, validateProfile } = require("./core");
const { rateLimited, conditionsCache } = require("./cache");
const { geocode, fetchLiveAQ, fetchWeather } = require("./live-data");
const { generatePlan } = require("./gemini");
const { sanitizePlan, buildImpactSummary } = require("./impact");
const { offlineAdvisor } = require("./offline-advisor");
const { CLIENT_MESSAGES, toClientError } = require("./errors");

const app = express();
const parseJson = express.json({ limit: config.BODY_LIMIT });

// Vercel may pre-parse JSON into req.body; local Express requests need parsing.
app.use((req, res, next) => {
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch (err) {
      req.body = undefined;
    }
  }
  if (req.body !== undefined) return next();
  return parseJson(req, res, next);
});

/** Small, dependency-free hardening headers plus CORS for split hosting. */
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Access-Control-Allow-Origin", config.CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Security-Policy", config.CONTENT_SECURITY_POLICY);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
}
app.use(securityHeaders);
app.use(express.static(path.join(__dirname, "..", "public")));

/** Turn the validated profile into a resolved location object. */
async function resolveLocation(profile) {
  if (profile.lat !== null && profile.lon !== null) {
    return {
      name: profile.locationName || "Current location",
      admin1: "",
      country: "",
      lat: profile.lat,
      lon: profile.lon,
      timezone: profile.timezone === "auto" ? "auto" : profile.timezone,
    };
  }
  // No hardcoded list and no autocomplete: geocode exactly what was typed.
  return (await geocode(profile.locationName))[0];
}

/** Fetch (or reuse cached) live air and weather for a location. */
async function loadConditions(loc) {
  const std = aqiStandardFor(loc.country);
  const key = [loc.lat.toFixed(3), loc.lon.toFixed(3), std].join(":");
  const cached = conditionsCache.get(key);
  if (cached) return cached;

  const [liveAqi, weather] = await Promise.all([
    fetchLiveAQ(loc.lat, loc.lon, loc.timezone, std),
    fetchWeather(loc.lat, loc.lon),
  ]);
  return conditionsCache.set(key, { liveAqi, weather, std });
}

/** Assemble the single context object consumed by both generation engines. */
function buildContext(profile, loc, conditions) {
  const { liveAqi, weather, std } = conditions;
  return {
    typedLocation: profile.locationName || loc.name, // exactly what the user typed
    location: loc,
    liveAqi,
    weather,
    aqiMeta: aqiMeta(liveAqi.aqi, std),
    commute: profile.commute || "unknown",
    work: profile.work || "office",
    household: profile.household || "n/a",
    diet: profile.diet || "n/a",
    energy: profile.energy || "n/a",
    family: profile.family || "n/a",
  };
}

/** Shape the public response from the internal context and generated plan. */
function buildResponse(loc, ctx, plan, result) {
  const a = ctx.aqiMeta;
  const live = ctx.liveAqi;
  return {
    location: { name: loc.name, admin1: loc.admin1, country: loc.country, lat: loc.lat, lon: loc.lon },
    aqi: {
      aqi: live.aqi,
      level: a.name,
      color: a.color,
      bg: a.bg,
      standard: a.standard,
      standardLabel: a.standardLabel,
      shortLabel: a.shortLabel,
      scale: a.scale,
      dominantPollutant: live.dominantPollutant,
      subIndices: live.subIndices,
      poll: live.poll,
      bestWindows: live.bestWindows,
      updated: live.updated,
    },
    weather: ctx.weather,
    plan,
    impact: buildImpactSummary(plan),
    engine: result.engine,
    live: result.live,
    error: result.error || null,
  };
}

app.get("/api/health", (req, res) => {
  // Deliberately minimal: no key presence or internal configuration leaks.
  res.json({ ok: true, model: config.GEMINI_MODEL, time: new Date().toISOString() });
});

app.post("/api/plan", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: CLIENT_MESSAGES.rateLimited });
  }

  const { profile, error } = validateProfile(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const loc = await resolveLocation(profile);
    const conditions = await loadConditions(loc);
    const ctx = buildContext(profile, loc, conditions);
    const result = await generatePlan(ctx);
    const plan = sanitizePlan(result.plan);
    return res.json(buildResponse(loc, ctx, plan, result));
  } catch (err) {
    const { status, message } = toClientError(err);
    return res.status(status).json({ error: message });
  }
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`AURA running on http://localhost:${config.PORT}`);
    console.log(`Gemini key: ${config.GEMINI_API_KEY ? "set" : "NOT SET (offline advisor will be used)"}`);
    console.log(`Default model: ${config.GEMINI_MODEL}`);
  });
}

module.exports = {
  app, offlineAdvisor, buildImpactSummary, sanitizePlan,
  resolveLocation, loadConditions, buildContext, buildResponse, securityHeaders,
};
