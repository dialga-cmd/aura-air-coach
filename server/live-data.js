/**
 * Live-data adapters for the keyless Open-Meteo APIs.
 *
 * All network I/O lives here. Pure helpers (averages, cleanest-hour windows,
 * pollutant mapping) are exported so they can be unit-tested without a network.
 */

"use strict";

const { UPSTREAM_TIMEOUT_MS, GEOCODE_BASE, AQ_BASE, WX_BASE } = require("./config");
const { aqiFor, ugM3ToMgM3, rankGeocodeResults } = require("./core");
const { geocodeCache } = require("./cache");
const { LocationNotFoundError, UpstreamUnavailableError } = require("./errors");
const {
  POLLUTANT, AQI_BREAKPOINT_KEY, POLLUTANT_NAMES, CURRENT_VARIABLES,
} = require("./pollutants");

const AVERAGE_HOURS = 24;
const WINDOW_HOURS = 4;
const WINDOW_STARTS = [4, 8, 12, 16, 20];
const WINDOW_COUNT = 3;
const round1 = (n) => Math.round(n * 10) / 10;

/** GET JSON with a timeout and typed failures. */
async function fetchJSON(url, params) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return; // never embed "undefined" in a URL
    target.searchParams.set(key, value);
  });
  const origin = `${target.origin}${target.pathname}`;
  let res;
  try {
    res = await fetch(target.toString(), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (cause) {
    throw new UpstreamUnavailableError(`Fetch failed for ${origin}`, { cause });
  }
  if (!res.ok) throw new UpstreamUnavailableError(`HTTP ${res.status} from ${origin}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new UpstreamUnavailableError(`Invalid JSON from ${origin}`, { cause });
  }
}

/** Reduce a decorated display label to the city name the user meant. */
function normaliseQuery(name) {
  let query = String(name || "").trim();
  query = query.replace(/\s*\([^)]*\)\s*$/, ""); // drop trailing (Country)
  query = query.split(",")[0].trim(); // keep the leading city name
  return query;
}

/** Geocode exactly what the user typed (no hardcoded list or autocomplete). */
async function geocode(name) {
  const query = normaliseQuery(name);
  if (!query) throw new LocationNotFoundError(name);

  const cacheKey = query.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchJSON(GEOCODE_BASE, { name: query, count: 12 });
  const results = rankGeocodeResults(data.results || []);
  if (!results.length) throw new LocationNotFoundError(name);

  return geocodeCache.set(cacheKey, results.map((r) => ({
    name: r.name,
    admin1: r.admin1 || r.admin2 || "",
    country: r.country || "",
    lat: r.latitude,
    lon: r.longitude,
    // Open-Meteo sometimes omits timezone — "auto" lets the AQ API infer it.
    timezone: r.timezone || "auto",
  })));
}

/** Mean of the first 24 non-null hourly values, or null when unavailable. */
function averageFirst24(values) {
  if (!values || values.length < AVERAGE_HOURS) return null;
  const valid = values.slice(0, AVERAGE_HOURS).filter((v) => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** Find the three cleanest non-overlapping 4-hour PM2.5 blocks in a day. */
function computeBestWindows(hourly) {
  const times = hourly?.time || [];
  const values = hourly?.pm2_5 || [];
  if (values.length < AVERAGE_HOURS) return [];

  const dayValues = values.slice(0, AVERAGE_HOURS).map((v) => (v == null ? Infinity : v));
  const dayTimes = times.slice(0, AVERAGE_HOURS);
  const hourAt = (idx) => (dayTimes[idx] ? dayTimes[idx].slice(11, 13) : String(idx).padStart(2, "0"));

  return WINDOW_STARTS
    .map((start) => {
      const block = dayValues.slice(start, start + WINDOW_HOURS);
      const mean = block.reduce((sum, v) => sum + v, 0) / WINDOW_HOURS;
      return { mean, hour: `${hourAt(start)}-${hourAt(start + WINDOW_HOURS)}` };
    })
    .sort((a, b) => a.mean - b.mean)
    .slice(0, WINDOW_COUNT)
    .map((slot) => ({ hour: slot.hour, pm25: round1(slot.mean) }));
}

/** Convert current readings into AQI sub-indices keyed by canonical pollutant id. */
function subIndicesFor(current, std, pm25, pm10) {
  const readings = {
    [POLLUTANT.PM25]: pm25,
    [POLLUTANT.PM10]: pm10,
    [POLLUTANT.OZONE]: current.ozone,
    [POLLUTANT.NO2]: current.nitrogen_dioxide,
    [POLLUTANT.CO]: ugM3ToMgM3(current.carbon_monoxide), // µg/m³ -> mg/m³ for AQI tables
  };
  const indices = {};
  for (const [id, value] of Object.entries(readings)) {
    indices[id] = aqiFor(AQI_BREAKPOINT_KEY[id], value, std);
  }
  return indices;
}

/** Fetch current pollutants plus an hourly curve and derive a region-aware AQI. */
async function fetchLiveAQ(lat, lon, tz, std = "epa") {
  const data = await fetchJSON(AQ_BASE, {
    latitude: lat,
    longitude: lon,
    current: CURRENT_VARIABLES,
    hourly: "pm2_5,pm10",
    forecast_days: 2,
    timezone: tz || "auto",
  });

  const current = data.current || {};
  // India's CPCB uses 24h averages for PM2.5/PM10; EPA uses near-real-time.
  const pm25 = std === "in" ? (averageFirst24(data.hourly?.pm2_5) ?? current.pm2_5) : current.pm2_5;
  const pm10 = std === "in" ? (averageFirst24(data.hourly?.pm10) ?? current.pm10) : current.pm10;

  const subIndices = subIndicesFor(current, std, pm25, pm10);
  // Headline AQI = worst pollutant sub-index (standard AQI method).
  const dominantId = Object.entries(subIndices).sort((a, b) => b[1] - a[1])[0][0];

  return {
    updated: current.time,
    standard: std,
    poll: {
      [POLLUTANT.PM25]: current.pm2_5 ?? null,
      [POLLUTANT.PM10]: current.pm10 ?? null,
      [POLLUTANT.OZONE]: current.ozone ?? null,
      [POLLUTANT.NO2]: current.nitrogen_dioxide ?? null,
      [POLLUTANT.CO]: current.carbon_monoxide ?? null,
    },
    aqi: subIndices[dominantId],
    dominantPollutant: POLLUTANT_NAMES[dominantId] || "PM2.5",
    subIndices,
    bestWindows: computeBestWindows(data.hourly),
  };
}

/** Weather is optional context: a failure must never break the plan. */
async function fetchWeather(lat, lon) {
  try {
    const data = await fetchJSON(WX_BASE, {
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m",
      timezone: "auto",
    });
    const c = data.current || {};
    return {
      temp: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      feelsLike: c.apparent_temperature,
      wind: c.wind_speed_10m,
    };
  } catch (cause) {
    // Optional enrichment only — the AQI plan is still useful without it.
    console.warn("[weather] unavailable:", cause.message);
    return null;
  }
}

module.exports = {
  fetchJSON, normaliseQuery, geocode, averageFirst24, computeBestWindows,
  subIndicesFor, fetchLiveAQ, fetchWeather,
};
