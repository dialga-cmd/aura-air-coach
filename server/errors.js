/**
 * Typed application errors and one place that maps them to safe client
 * responses. Upstream/provider details stay in the server logs.
 */

"use strict";

class LocationNotFoundError extends Error {
  constructor(name) {
    super(`No location found for "${name}"`);
    this.name = "LocationNotFoundError";
  }
}

class UpstreamUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UpstreamUnavailableError";
  }
}

/** Generic messages safe to show to a client — never include upstream bodies. */
const CLIENT_MESSAGES = Object.freeze({
  location: "We couldn't find that city. Try a nearby city name.",
  upstream: "The live air-quality service is temporarily unavailable. Please try again shortly.",
  fallback: "We couldn't build your plan right now. Please try again.",
  rateLimited: "Too many plans requested. Please wait a few minutes and try again.",
});

/**
 * Map a thrown error to an HTTP status and a public message.
 * @returns {{status: number, message: string}}
 */
function toClientError(err) {
  if (err instanceof LocationNotFoundError) {
    return { status: 404, message: CLIENT_MESSAGES.location };
  }
  if (err instanceof UpstreamUnavailableError) {
    return { status: 502, message: CLIENT_MESSAGES.upstream };
  }
  console.error("[api/plan]", err);
  return { status: 502, message: CLIENT_MESSAGES.fallback };
}

module.exports = {
  LocationNotFoundError, UpstreamUnavailableError, CLIENT_MESSAGES, toClientError,
};
