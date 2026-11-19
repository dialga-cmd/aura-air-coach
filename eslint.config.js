/** Flat ESLint config shared by server, browser and test code. */

"use strict";

const js = require("@eslint/js");

module.exports = [
  { ignores: ["node_modules/**", "coverage/**"] },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs" },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    files: ["server/**/*.js", "api/**/*.js", "test/**/*.js", "eslint.config.js"],
    languageOptions: {
      globals: {
        console: "readonly", process: "readonly", require: "readonly",
        module: "writable", __dirname: "readonly", fetch: "readonly",
        AbortSignal: "readonly", URL: "readonly", URLSearchParams: "readonly",
      },
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly", window: "readonly", navigator: "readonly",
        location: "readonly", fetch: "readonly", console: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
];
