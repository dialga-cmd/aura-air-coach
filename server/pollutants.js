/**
 * Canonical pollutant vocabulary.
 *
 * Each layer used to spell the same pollutant differently (Open-Meteo fields,
 * AQI break-point keys, display keys). This module is the single mapping point
 * at the API boundary so names cannot drift between layers.
 */

"use strict";

const POLLUTANT = Object.freeze({
  PM25: "pm2_5",
  PM10: "pm10",
  OZONE: "ozone",
  NO2: "no2",
  CO: "co",
});

/** Open-Meteo `current` field -> canonical id. */
const OPEN_METEO_FIELDS = Object.freeze({
  pm2_5: POLLUTANT.PM25,
  pm10: POLLUTANT.PM10,
  ozone: POLLUTANT.OZONE,
  nitrogen_dioxide: POLLUTANT.NO2,
  carbon_monoxide: POLLUTANT.CO,
});

/** Canonical id -> break-point key used by core.js AQI tables. */
const AQI_BREAKPOINT_KEY = Object.freeze({
  [POLLUTANT.PM25]: "pm2_5",
  [POLLUTANT.PM10]: "pm10",
  [POLLUTANT.OZONE]: "ozone",
  [POLLUTANT.NO2]: "nitrogen_dioxide",
  [POLLUTANT.CO]: "carbon_monoxide",
});

const POLLUTANT_NAMES = Object.freeze({
  [POLLUTANT.PM25]: "PM2.5 (fine smog particles)",
  [POLLUTANT.PM10]: "PM10 (coarse dust)",
  [POLLUTANT.OZONE]: "Ground-level Ozone",
  [POLLUTANT.NO2]: "Nitrogen Dioxide",
  [POLLUTANT.CO]: "Carbon Monoxide",
});

/** Comma-separated Open-Meteo `current` variables, in canonical order. */
const CURRENT_VARIABLES = Object.keys(OPEN_METEO_FIELDS).join(",");

module.exports = {
  POLLUTANT, OPEN_METEO_FIELDS, AQI_BREAKPOINT_KEY, POLLUTANT_NAMES, CURRENT_VARIABLES,
};
