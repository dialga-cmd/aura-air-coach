/** Vercel serverless entry point for GET /api/health. */
const { app } = require("../server/index");

module.exports = (req, res) => app(req, res);
