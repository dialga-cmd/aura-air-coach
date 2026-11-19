# AURA — Air-Quality GenAI Life Coach

> A GenAI assistant that helps **families and communities navigate severe winter
> smog and urban air pollution**. It builds a **low-emission daily routine**,
> **indoor air-quality hacks**, and **sustainable alternatives** tailored to a
> typed city and lifestyle — and explains the **direct impact** of each choice.

---

## 1. Chosen challenge vertical

**Climate & Sustainability.**

**Persona:** a parent/caregiver in a smog-prone city (for example Delhi in
winter) who needs to protect kids, an asthmatic family member and an elderly
relative while still getting to work, cooking and running a household. AURA is
their daily decision assistant: *"Given today's air and the way we live, what
should we change — and what does it actually save?"*

The solution is designed around that persona's logic:

| Persona need | AURA response |
|---|---|
| "Is it safe to go out?" | Live, **region-correct AQI** + cleanest hours of the day |
| "What can we do *today*?" | Morning / daytime / evening low-emission routine |
| "The air is already inside" | Indoor-air hacks (HEPA, ventilation timing, cooking fumes, sealing) |
| "We don't want to stop living" | Practical sustainable swaps matched to commute, diet and energy habits |
| "Does it make a difference?" | Deterministic CO₂, trees and indoor-PM impact figures |

---

## 2. Approach and logic

`typed city + lifestyle profile → live context → GenAI plan → computed impact → UI`

1. **Resolve the city.** The user types any city name — there is **no hardcoded
   list and no autocomplete**. The server silently geocodes it with Open-Meteo
   and takes the top match (major cities ranked first), while the *raw typed
   text* is still passed to Gemini.
2. **Read the air.** Keyless Open-Meteo Air-Quality + Forecast APIs supply
   PM2.5, PM10, ozone, NO₂, CO, weather and a 24-hour PM2.5 curve. The cleanest
   four-hour windows are computed from that curve.
3. **Apply the local AQI standard.** India → **CPCB AQI** (six categories, 24h
   PM averages). US → **US EPA AQI**. Everywhere else → EPA scale, *explicitly
   labelled as a reference*, never presented as an official local index.
4. **Generate the plan.** A free-tier Gemini model receives the live context and
   the lifestyle profile and returns **strict JSON** (routine, indoor-air,
   swaps, sensitive-member notes, next check). Gemini is told that profile
   fields are untrusted data, not instructions.
5. **Compute the numbers locally.** CO₂ saved, annual CO₂ and tree-equivalent
   are **never taken from the model** — they are recomputed from the suggested
   actions using a single deduplicated factor table. The model only contributes
   qualitative explanations.
6. **Degrade gracefully.** With no API key, or if Gemini fails, a rule-based
   offline advisor produces a complete plan so the demo never breaks.

---

## 3. How the solution works

### Run it

```bash
npm install
cp .env.example .env          # then set GEMINI_API_KEY=your_key
npm start                     # http://localhost:3000
```

A key is **optional**: without one the offline advisor runs. Get a free key at
<https://aistudio.google.com/> (no card required).

### Deploying on Vercel

The repo includes `api/health.js` and `api/plan.js`, thin serverless wrappers
around the same Express app, so Vercel serves both the static UI and the API.
Set these project settings:

- **Framework:** Other / no framework
- **Output directory:** `public` (so `/` serves `public/index.html`)
- **Environment variables:** `GEMINI_API_KEY`, and `GEMINI_TIMEOUT_MS=8000`
  if you are on the Hobby plan's ~10 s function limit

Push to `main` and Vercel rebuilds automatically. If you instead host the UI as
pure static files elsewhere, append `?api=https://your-backend.example` to the
page URL (or set `window.AURA_API_BASE`) to point it at a separately deployed
backend. The browser shows a clear "API unavailable" message instead of a JSON
parse error if that backend is missing.

### Model selection

Default: **`gemini-3.5-flash-lite`** with a generous free tier (Google's limits
change — check current docs before a public demo). Fallback:
`gemini-3.1-flash-lite`. Override with `GEMINI_MODEL`. `gemini-2.5-flash-lite`
was deliberately removed from the fallback list because new keys cannot always
access it. Verified endpoint format:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
x-goog-api-key: <key>
generationConfig.responseMimeType = "application/json"
```

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Minimal liveness + configured model (no key disclosure) |
| `POST` | `/api/plan` | Full plan for a typed city + lifestyle |

Request body:

```json
{
  "locationName": "Delhi",
  "lat": null, "lon": null, "timezone": "",
  "commute": "car", "work": "office", "household": "family of 4",
  "diet": "balanced", "energy": "gas heating", "family": "two kids, one with asthma"
}
```

Response (abridged):

```json
{
  "location": {"name":"Delhi","country":"India"},
  "aqi": {
    "aqi": 209, "level": "Poor", "standard": "in",
    "standardLabel": "India AQI (CPCB)", "shortLabel": "India AQI",
    "scale": [{"name":"Good","min":0,"max":50}, "..."],
    "dominantPollutant": "Ground-level Ozone",
    "subIndices": {"pm25":203,"pm10":92,"ozone":209,"no2":20,"co":38},
    "poll": {"pm2_5":67.3,"ozone":172},
    "bestWindows": [{"hour":"12-16","pm25":55.3}]
  },
  "weather": {"temp":22.9,"humidity":52,"feelsLike":23.6,"wind":3.6},
  "plan": {"headline":"…","routine":{"am":[],"day":[],"pm":[]},
           "indoorAir":[],"sustainability":[],"sensitiveNotes":[],"nextCheck":"…"},
  "impact": {"dailyCO2SavedKg":12,"annualCO2SavedKg":4380,
             "treesEquivalentPerYear":208.6,"indoorHEPAReductionPct":70,
             "swapsCount":5,"localAQIBenefit":"…","indoorAirBenefit":"…"},
  "engine": "gemini:gemini-3.5-flash-lite", "live": true, "error": null
}
```

`engine` + `live` report the engine that **actually** produced the plan; the UI
uses them for its status pill and footer instead of assuming Gemini ran.

### Project layout

```
challenge-6/
├─ server/
│  ├─ index.js       # Express routes, live-data adapters, Gemini + offline advisor
│  ├─ core.js        # PURE logic: AQI standards, impact math, validation (unit-tested)
│  └─ dotenv.js      # dependency-free .env loader
├─ public/
│  ├─ index.html    # semantic markup, skip link, aria-live regions
│  ├─ style.css     # light "climate console" theme, focus rings, reduced-motion
│  └─ app.js         # typed-city flow, fetch, safe DOM rendering
├─ test/
│  ├─ core.test.js  # AQI breakpoints, impact math, validation
│  └─ api.test.js   # HTTP contract, sanitisation, offline advisor
├─ .env.example
├─ package.json
└─ README.md
```

---

## 4. Assumptions and limitations

- **Live air data is modelled** by Open-Meteo (global reanalysis/forecast). It
  is excellent for demos and relative trends but is **not a substitute** for an
  official station-level reading (EPA / CPCB sensors).
- **AQI method:** the worst pollutant sub-index is the headline AQI. India uses
  CPCB breakpoints with 24-hour PM averages; other countries use EPA
  breakpoints where no local scale is implemented, and the UI says so.
- **CO₂ factors** (e.g. ~9 kg/day for replacing a 5 km car commute) are standard
  reference estimates. Each habit is counted **once**, even if it appears in
  several sections of the plan.
- **Indoor PM2.5 ≈70%** is a *typical* well-sealed HEPA purifier result in one
  room, not a guarantee. AURA does **not** claim a precise street-level AQI
  reduction.
- **Advisory only — not medical advice.** Follow local health guidance for
  smog alerts; AURA supports decisions, it does not replace them.
- **Free-tier Gemini content may be used by Google to improve its products.**
  Keep personal data out of the profile fields.

---

## 5. Security, efficiency and testing

- **Security:** bounded request body (16 KB), server-side field length caps,
  control-character stripping and coordinate range checks; profile text is
  marked as untrusted in the Gemini prompt; LLM output is sanitised before
  reaching the browser; all dynamic text uses `textContent` (no HTML injection);
  minimal health payload; generic client errors (upstream bodies stay in server
  logs); `nosniff`, `X-Frame-Options`, `Referrer-Policy` and a CSP are set.
  `.env` is gitignored — **never commit a real key**.
- **Efficiency:** geocoding cached for 24h, live conditions for 10 min, both in
  size-bounded TTL caches; a per-IP fixed-window limit protects the free quota;
  all outbound calls have timeouts; zero client-side dependencies/build step.
- **Testing:** `npm test` runs **20 `node:test` tests** covering AQI standard
  selection, breakpoint gap boundaries, category ranges, input validation,
  deduplicated impact math, sanitisation, HTTP error contract and both offline
  advisor branches. Tests need no network and no API key.

```bash
npm test
```

- **Accessibility:** semantic headings/labels, skip link, visible
  `:focus-visible` rings, `aria-live` loading/announcements, `role="alert"`
  errors, AA-contrast text tokens, dark badge text with a coloured status dot,
  and a `prefers-reduced-motion` fallback.

---

## 6. Demo script (for judges, ~2 minutes)

1. Open the app and type **Delhi**. Generate. Point out the gauge reads
   **India AQI (CPCB)** with six categories — not a US scale.
2. Set commute = *Car*, work = *Office*, sensitive members = *two kids, one with
   asthma*. Regenerate: the plan changes with the profile.
3. Show the **cleanest hours** chips, one routine item with its impact tag, an
   indoor-air hack with its "why", and the impact tiles.
4. Contrast with **London** or **New York** — the scale label and category names
   change; a clean city flips the advice toward outdoor low-carbon time.
5. Mention the offline fallback (delete the key and regenerate) and that all
   live data is keyless Open-Meteo.
