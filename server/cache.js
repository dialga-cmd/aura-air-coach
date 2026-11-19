/**
 * Small in-process caches and a fixed-window rate limiter.
 *
 * Keyless upstream APIs and the Gemini free tier are finite resources; these
 * helpers keep request volume bounded. All stores are size-bounded so a busy
 * process cannot leak memory.
 */

"use strict";

const {
  GEOCODE_TTL_MS, CONDITIONS_TTL_MS, CACHE_MAX_ENTRIES,
  RATE_WINDOW_MS, RATE_LIMIT, RATE_MAX_IPS,
} = require("./config");

/**
 * Create a time-to-live cache that evicts the oldest entry when full.
 * @param {number} ttlMs entry lifetime
 * @param {number} [maxEntries] maximum number of entries
 */
function createCache(ttlMs, maxEntries = CACHE_MAX_ENTRIES) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      if (store.size >= maxEntries) store.delete(store.keys().next().value);
      store.set(key, { at: Date.now(), value });
      return value;
    },
  };
}

const geocodeCache = createCache(GEOCODE_TTL_MS);
const conditionsCache = createCache(CONDITIONS_TTL_MS);

/**
 * Create a fixed-window limiter keyed by an arbitrary string (usually an IP).
 * @returns {(key: string) => boolean} true when the key has exceeded its quota
 */
function createRateLimiter({ windowMs, limit, maxKeys }) {
  const hits = new Map();
  return function rateLimited(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  };
}

const rateLimited = createRateLimiter({
  windowMs: RATE_WINDOW_MS,
  limit: RATE_LIMIT,
  maxKeys: RATE_MAX_IPS,
});

module.exports = { createCache, createRateLimiter, geocodeCache, conditionsCache, rateLimited };
