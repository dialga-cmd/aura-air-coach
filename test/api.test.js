const test = require("node:test");
const assert = require("node:assert/strict");

// Force the offline path: loadEnv() only fills undefined variables.
process.env.GEMINI_API_KEY = "";

const { app, offlineAdvisor, buildImpactSummary, sanitizePlan } = require("../server/index");

let server;
let base;
let listener;

test.before(async () => {
  await new Promise((resolve) => {
    listener = app.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${listener.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => listener.close(resolve));
});

test("GET /api/health exposes no secrets", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.geminiKey, undefined);
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("GET / serves the app", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /AURA/);
});

test("CORS preflight is handled for cross-origin API hosting", async () => {
  const res = await fetch(`${base}/api/plan`, { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("POST /api/plan rejects missing or invalid locations", async () => {
  for (const body of [{}, { locationName: "  " }, { lat: 999, lon: 0 }]) {
    const res = await fetch(`${base}/api/plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Provide a city name/);
  }
});

test("model-provided impact numbers are ignored; local math wins", () => {
  const plan = {
    routine: {
      am: [{ title: "Walk to work" }],
      day: [{ title: "Plant-forward lunch" }],
      pm: [{ title: "Cold laundry" }],
    },
    indoorAir: [{ title: "Run HEPA purifier" }],
    sustainability: [{ title: "Public transit swap" }],
    impactSummary: {
      dailyCO2SavedKg: 999, annualCO2SavedKg: 999999,
      treesEquivalentPerYear: 9999,
      localAQIBenefit: "  Locally computed explanation.  ",
    },
  };
  const impact = buildImpactSummary(plan);
  assert.equal(impact.dailyCO2SavedKg, 9 + 1.2 + 0.8 + 7.2);
  assert.equal(impact.annualCO2SavedKg, Math.round(impact.dailyCO2SavedKg * 365 * 10) / 10);
  assert.equal(impact.localAQIBenefit, "Locally computed explanation.");
  assert.ok(impact.indoorAirBenefit.length > 10); // fallback text supplied
  assert.equal(impact.swapsCount, 4);
});

test("sanitizePlan bounds hostile model output", () => {
  const clean = sanitizePlan({
    headline: "OK\u0000<script>alert(1)</script>",
    routine: { am: [{ title: "x".repeat(900) }] },
  });
  assert.equal(clean.headline, "OK <script>alert(1)</script>"); // inert text, not executable
  assert.equal(clean.routine.am[0].title.length, 500);
});

test("offline advisor produces a smog plan and a clean-air plan", () => {
  const baseCtx = {
    liveAqi: { aqi: 220, bestWindows: [{ hour: "12-16" }, { hour: "04-08" }], poll: {} },
    aqiMeta: { name: "Poor" },
    commute: "car", work: "office", household: "family of 4", diet: "balanced",
    energy: "gas heating", family: "two kids, one with asthma",
  };
  const smog = offlineAdvisor(baseCtx);
  assert.match(smog.headline, /smog/i);
  assert.ok(smog.routine.am.length >= 3);
  assert.ok(smog.indoorAir.some((i) => /HEPA/i.test(i.title)));
  assert.ok(smog.sustainability.length >= 3);

  const clean = offlineAdvisor({ ...baseCtx, liveAqi: { ...baseCtx.liveAqi, aqi: 35 } });
  assert.match(clean.headline, /Good air/i);
  assert.ok(clean.routine.am.some((i) => /fresh[- ]air|walk|bik|cycl/i.test(i.title)));
});
