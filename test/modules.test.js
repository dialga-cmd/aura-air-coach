const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GEMINI_API_KEY = "";

const { parseGeminiJSON, buildUserPrompt } = require("../server/gemini");
const { averageFirst24, computeBestWindows, normaliseQuery, subIndicesFor } = require("../server/live-data");
const { createCache, createRateLimiter } = require("../server/cache");
const { toClientError, LocationNotFoundError, UpstreamUnavailableError } = require("../server/errors");
const { formatImpact } = require("../server/impact");

test("parseGeminiJSON accepts plain, fenced and embedded objects", () => {
  assert.deepEqual(parseGeminiJSON('{"headline":"ok"}'), { headline: "ok" });
  assert.deepEqual(parseGeminiJSON('```json\n{ "headline": "fenced" }\n```'), { headline: "fenced" });
  assert.deepEqual(parseGeminiJSON('Intro {"headline":"embedded { brace }","n":2} outro'),
    { headline: "embedded { brace }", n: 2 });
});

test("parseGeminiJSON rejects text with no object", () => {
  assert.throws(() => parseGeminiJSON("no json here"), /unparseable/);
  assert.throws(() => parseGeminiJSON(null), /unparseable/);
});

test("best-window math picks three cleanest non-overlapping blocks", () => {
  const values = Array.from({ length: 24 }, (_, i) => 100);
  [4, 5, 6, 7, 8, 9, 10, 11].forEach((i) => { values[i] = 10; }); // 04-08 and 08-12 are cleanest
  const time = Array.from({ length: 24 }, (_, i) => `2026-01-01T${String(i).padStart(2, "0")}:00`);
  const windows = computeBestWindows({ time, pm2_5: values });
  assert.equal(windows.length, 3);
  assert.deepEqual(windows[0], { hour: "04-08", pm25: 10 });
  assert.ok(windows[0].pm25 <= windows[1].pm25);
  assert.deepEqual(computeBestWindows({}), []);
});

test("24-hour average ignores nulls and needs a full day", () => {
  const day = Array.from({ length: 24 }, () => 20);
  day[3] = null;
  assert.equal(averageFirst24(day), 20);
  assert.equal(averageFirst24(day.slice(0, 23)), null);
});

test("normaliseQuery reduces a decorated label to the city name", () => {
  assert.equal(normaliseQuery("  Delhi, National Capital Territory (India) "), "Delhi");
  assert.equal(normaliseQuery("New York"), "New York");
  assert.equal(normaliseQuery("   "), "");
});

test("pollutant sub-indices use canonical keys and the mg/m3 CO conversion", () => {
  const current = { pm2_5: 60, pm10: 90, ozone: 100, nitrogen_dioxide: 40, carbon_monoxide: 1000 };
  const indices = subIndicesFor(current, "us", 60, 90);
  assert.deepEqual(Object.keys(indices), ["pm2_5", "pm10", "ozone", "no2", "co"]);
  assert.equal(indices.co, require("../server/core").aqiFor("carbon_monoxide", 1, "us"));
});

test("TTL cache evicts oldest entries and honours expiry", () => {
  const cache = createCache(60_000, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3); // evicts "a"
  assert.equal(cache.get("a"), null);
  assert.equal(cache.get("c"), 3);
  const expiring = createCache(-1);
  expiring.set("x", 1);
  assert.equal(expiring.get("x"), null);
});

test("rate limiter allows up to the limit then blocks", () => {
  const limited = createRateLimiter({ windowMs: 60_000, limit: 2, maxKeys: 10 });
  assert.equal(limited("1.2.3.4"), false);
  assert.equal(limited("1.2.3.4"), false);
  assert.equal(limited("1.2.3.4"), true);
  assert.equal(limited("5.6.7.8"), false); // independent keys
});

test("typed errors map to specific client responses without leaking details", () => {
  assert.deepEqual(toClientError(new LocationNotFoundError("X")),
    { status: 404, message: "We couldn't find that city. Try a nearby city name." });
  const upstream = toClientError(new UpstreamUnavailableError("secret upstream body"));
  assert.equal(upstream.status, 502);
  assert.match(upstream.message, /temporarily unavailable/);
  assert.ok(!/secret upstream/.test(upstream.message));
  const original = console.error;
  console.error = () => {};
  try {
    const result = toClientError(new Error("provider key leaked"));
    assert.equal(result.status, 502);
    assert.ok(!/provider key/.test(result.message));
  } finally {
    console.error = original;
  }
});

test("formatImpact supplies qualified defaults for qualitative explanations", () => {
  const computed = { dailyKgCO2: 1, annualKgCO2: 365, treesEquivalent: 17.4, indoorHEPAReductionPct: 70, details: [] };
  const impact = formatImpact(computed, {});
  assert.equal(impact.swapsCount, 0);
  assert.match(impact.localAQIBenefit, /Lower-emission routines/);
  assert.match(impact.indoorAirBenefit, /70% lower/);
});

test("Gemini prompt marks profile data as untrusted and keeps the typed city", () => {
  const prompt = buildUserPrompt({
    typedLocation: "Delhi",
    location: { name: "Delhi", admin1: "Delhi", country: "India" },
    liveAqi: { aqi: 200, dominantPollutant: "Ozone", poll: { pm2_5: 60, ozone: 100, no2: 20 }, bestWindows: [] },
    aqiMeta: { standardLabel: "India AQI (CPCB)", name: "Poor" },
    weather: null, commute: "car", work: "office", household: "family", diet: "mixed", energy: "gas", family: "kids",
  });
  assert.match(prompt, /untrusted user data/);
  assert.match(prompt, /LOCATION \(as the user typed it\): Delhi/);
  assert.match(prompt, /India AQI \(CPCB\) = 200/);
});
