/**
 * AURA configuration — the single place where environment and tuning values
 * are read and named. Loading .env here guarantees every module that needs
 * config sees the same values, regardless of require order.
 */

"use strict";

require("./dotenv").loadEnv(".env"); // real process env vars always win

const env = process.env;

/** Free-tier Gemini models, best-first. Override the primary with GEMINI_MODEL. */
const GEMINI_MODEL_DEFAULT = "gemini-3.5-flash-lite";
const GEMINI_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

const UPSTREAM_TIMEOUT_MS = 8000;
// Vercel Hobby functions have a ~10s limit; set GEMINI_TIMEOUT_MS=8000 there.
const GEMINI_TIMEOUT_MS = Number(env.GEMINI_TIMEOUT_MS) || 20000;

const CONDITIONS_TTL_MS = 10 * 60 * 1000; // live air changes slowly; protect the free quota
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 25; // plans per IP per window
const RATE_MAX_IPS = 1000; // bounded memory for the rate-limit map

const BODY_LIMIT = "16kb";
const PORT = env.PORT || 3000;
const CORS_ORIGIN = env.CORS_ORIGIN || "*";

const GEMINI_API_KEY = env.GEMINI_API_KEY || "";
const GEMINI_MODEL = env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
const GEMINI_ENDPOINT = env.GEMINI_ENDPOINT ||
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";

const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const AQ_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WX_BASE = "https://api.open-meteo.com/v1/forecast";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self' https: http://localhost:*",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

module.exports = {
  GEMINI_MODEL_DEFAULT, GEMINI_FALLBACKS, GEMINI_MODEL, GEMINI_API_KEY,
  GEMINI_ENDPOINT, GEMINI_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS, CONDITIONS_TTL_MS, GEOCODE_TTL_MS, CACHE_MAX_ENTRIES,
  RATE_WINDOW_MS, RATE_LIMIT, RATE_MAX_IPS,
  BODY_LIMIT, PORT, CORS_ORIGIN, CONTENT_SECURITY_POLICY,
  GEOCODE_BASE, AQ_BASE, WX_BASE,
};
