const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aqiStandardFor, aqiMeta, aqiFor, ugM3ToMgM3,
  buildImpact, INDOOR_HEPA_REDUCTION_PCT,
  cleanText, parseCoordinate, validateProfile, rankGeocodeResults,
} = require("../server/core");

test("chooses the region's official AQI standard", () => {
  assert.equal(aqiStandardFor("India"), "in");
  assert.equal(aqiStandardFor("india"), "in");
  assert.equal(aqiStandardFor("United States"), "us");
  assert.equal(aqiStandardFor("USA"), "us");
  assert.equal(aqiStandardFor("United Kingdom"), "epa");
  assert.equal(aqiStandardFor(""), "epa");
});

test("India AQI uses six CPCB categories with correct ranges", () => {
  const meta = aqiMeta(209, "in");
  assert.equal(meta.name, "Poor");
  assert.equal(meta.standard, "in");
  assert.equal(meta.shortLabel, "India AQI");
  assert.deepEqual(meta.scale.map((s) => s.name),
    ["Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"]);
  assert.equal(aqiMeta(75, "in").name, "Satisfactory");
  assert.equal(aqiMeta(350, "in").name, "Very Poor");
  assert.equal(aqiMeta(450, "in").name, "Severe");
});

test("US AQI keeps five EPA categories", () => {
  assert.equal(aqiMeta(56, "us").name, "Moderate");
  assert.equal(aqiMeta(160, "us").name, "Very Unhealthy");
  assert.equal(aqiMeta(260, "us").name, "Hazardous");
  assert.equal(aqiMeta(35, "epa").shortLabel, "AQI (EPA scale)");
});

test("AQI values are clamped to 0–500", () => {
  assert.equal(aqiMeta(-20, "in").aqi, 0);
  assert.equal(aqiMeta(900, "us").aqi, 500);
});

test("published breakpoint gaps never fall through to 500", () => {
  // India NO₂ table jumps 41–80 -> 85–180; 81–84 must map to the next bucket.
  const no2_82 = aqiFor("nitrogen_dioxide", 82, "in");
  assert.ok(no2_82 > 100 && no2_82 < 200, `India NO₂ 82 -> ${no2_82}`);
  // EPA PM2.5 table jumps 12.0 -> 12.1.
  const pm25_1205 = aqiFor("pm2_5", 12.05, "us");
  assert.ok(pm25_1205 >= 50 && pm25_1205 <= 52, `EPA PM2.5 12.05 -> ${pm25_1205}`);
  // A large but in-table value still yields a valid category, never a gap error.
  assert.ok(aqiFor("ozone", 300, "us") >= 201);
});

test("AQI breakpoints handle exact boundaries and invalid input", () => {
  assert.equal(aqiFor("pm2_5", 0, "in"), 0);
  assert.equal(aqiFor("pm2_5", 30, "in"), 50);
  assert.equal(aqiFor("pm2_5", 31, "in"), 51);
  assert.equal(aqiFor("pm2_5", 500, "in"), 500);
  assert.equal(aqiFor("pm2_5", null, "in"), 0);
  assert.equal(aqiFor("pm2_5", NaN, "in"), 0);
});

test("Open-Meteo CO µg/m³ is converted to AQI mg/m³", () => {
  assert.equal(ugM3ToMgM3(768), 0.768);
  assert.equal(ugM3ToMgM3(null), null);
});

test("impact math is deterministic and deduplicates repeated habits", () => {
  const result = buildImpact([
    { key: "walk to work" }, { key: "bike commute" }, { key: "public transit" },
    { key: "plant-based dinner" }, { key: "cold laundry" }, { key: "LED bulbs" },
  ]);
  assert.equal(result.dailyKgCO2, 9 + 7.2 + 1.2 + 0.8 + 0.6);
  assert.equal(result.annualKgCO2, Math.round(result.dailyKgCO2 * 365 * 10) / 10);
  assert.equal(result.treesEquivalent, Math.round((result.dailyKgCO2 * 365 / 21) * 10) / 10);
  assert.equal(result.indoorHEPAReductionPct, INDOOR_HEPA_REDUCTION_PCT);
  assert.equal(result.details.length, 5); // walk + bike collapse into one category
});

test("unrecognised actions contribute nothing and a green office is not remote work", () => {
  const result = buildImpact([
    { key: "green office desk environment" },
    { key: "some unrelated tip" },
    { key: "work from home today" },
  ]);
  assert.equal(result.dailyKgCO2, 9.5);
  assert.deepEqual(result.details.map((d) => d.action), ["remote_work"]);
});

test("cleanText strips control characters and caps length", () => {
  assert.equal(cleanText("  Delhi\u0000\n  India ", 80), "Delhi India");
  assert.equal(cleanText("x".repeat(50), 10).length, 10);
  assert.equal(cleanText(null, 10), "");
});

test("parseCoordinate rejects non-finite values but accepts zero", () => {
  assert.equal(parseCoordinate(0), 0);
  assert.equal(parseCoordinate("28.6"), 28.6);
  assert.equal(parseCoordinate("abc"), null);
  assert.equal(parseCoordinate(Infinity), null);
  assert.equal(parseCoordinate(null), null);
});

test("validateProfile requires a usable location", () => {
  assert.match(validateProfile({}).error, /Provide a city name/);
  assert.match(validateProfile({ locationName: "   " }).error, /Provide a city name/);
  assert.match(validateProfile({ lat: 999, lon: 0 }).error, /Provide a city name/);
});

test("validateProfile normalises and bounds untrusted fields", () => {
  const { profile, error } = validateProfile({
    locationName: "Delhi\u0000 India",
    lat: "28.6139", lon: "77.2090", timezone: "<script>",
    family: "x".repeat(500), commute: "car",
  });
  assert.equal(error, undefined);
  assert.equal(profile.locationName, "Delhi India");
  assert.equal(profile.lat, 28.6139);
  assert.equal(profile.lon, 77.209);
  assert.equal(profile.timezone, "auto"); // malicious value rejected
  assert.equal(profile.family.length, 120);
  assert.equal(profile.commute, "car");
});

test("geocoding ranks major cities before small places", () => {
  const ranked = rankGeocodeResults([
    { name: "Delhi", population: 1000, feature_code: "PPL" },
    { name: "Delhi", population: 20_000_000, feature_code: "PPLA" },
    { name: "Delhi", population: 5000, feature_code: "PPL" },
  ]);
  assert.equal(ranked[0].population, 20_000_000);
  assert.equal(ranked.length, 3); // input is never mutated
});
