import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "**/.next-e2e/**",
      "**/.next-e2e-prod/**",
      "**/.e2e-hourly/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.expo/**",
      "apps/mobile/expo-env.d.ts",
    ],
  },
  js.configs.recommended,
  {
    // Node config files (next.config.mjs etc.).
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  ...tseslint.configs.recommended,
  {
    // CommonJS Node scripts (e2e fixture builders, Metro config); after the TS presets so the rule override wins.
    files: ["**/*.cjs", "apps/mobile/metro.config.js", "apps/mobile/plugins/*.js"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", __dirname: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
