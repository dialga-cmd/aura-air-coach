/** Shared Vercel serverless adapter: reuse the Express app, no duplicated logic. */

"use strict";

const { app } = require("./index");

module.exports = (req, res) => app(req, res);
