/**
 * Plan sanitisation and the impact contract.
 *
 * Numeric impact values are always recomputed locally from the suggested
 * actions; the model may only supply qualitative explanations. This keeps the
 * dashboard honest regardless of how Gemini phrases its response.
 */

"use strict";

const { buildImpact, cleanText, INDOOR_HEPA_REDUCTION_PCT } = require("./core");

const CAPS = Object.freeze({
  string: 500,
  title: 120,
  explanation: 260,
  maxDepth: 4,
  maxItems: 30,
  maxKeys: 30,
});

const DEFAULT_LOCAL_BENEFIT =
  "Lower-emission routines reduce your household's contribution to local smog.";
const DEFAULT_INDOOR_BENEFIT =
  `Filtration and source control can keep indoor particles roughly ${INDOOR_HEPA_REDUCTION_PCT}% lower on smog days.`;

/** Bound and clean every string in an LLM-generated plan before it reaches the UI. */
function sanitizePlan(plan) {
  const walk = (value, depth) => {
    if (typeof value === "string") return cleanText(value, CAPS.string);
    if (Array.isArray(value)) {
      return depth > CAPS.maxDepth ? [] : value.slice(0, CAPS.maxItems).map((item) => walk(item, depth + 1));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, val] of Object.entries(value).slice(0, CAPS.maxKeys)) out[key] = walk(val, depth + 1);
      return out;
    }
    return value;
  };
  return walk(plan || {}, 0);
}

/** Collect suggested action titles so the numbers can be recomputed deterministically. */
function collectActions(plan) {
  const groups = [
    plan?.routine?.am, plan?.routine?.day, plan?.routine?.pm,
    plan?.indoorAir, plan?.sustainability,
  ];
  return groups
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .map((item) => ({ key: cleanText(item?.title, CAPS.title) }));
}

/** The single impact-to-response mapping shared by the live and offline engines. */
function formatImpact(computed, generated = {}) {
  return {
    dailyCO2SavedKg: computed.dailyKgCO2,
    annualCO2SavedKg: computed.annualKgCO2,
    treesEquivalentPerYear: computed.treesEquivalent,
    indoorHEPAReductionPct: computed.indoorHEPAReductionPct,
    swapsCount: computed.details.length,
    localAQIBenefit: cleanText(generated.localAQIBenefit, CAPS.explanation) || DEFAULT_LOCAL_BENEFIT,
    indoorAirBenefit: cleanText(generated.indoorAirBenefit, CAPS.explanation) || DEFAULT_INDOOR_BENEFIT,
  };
}

/** Recompute impact for a generated plan, ignoring any model-supplied numbers. */
function buildImpactSummary(plan) {
  return formatImpact(buildImpact(collectActions(plan)), plan?.impactSummary);
}

module.exports = {
  CAPS, sanitizePlan, collectActions, formatImpact, buildImpactSummary,
};
