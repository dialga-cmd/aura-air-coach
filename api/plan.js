/**
 * Vercel serverless entry point for POST /api/plan.
 * Reuses the same Express app as local `npm start` — no duplicated logic.
 */
const { app } = require("../server/index");

module.exports = (req, res) => app(req, res);
