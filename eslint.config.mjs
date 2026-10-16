import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**", "**/next-env.d.ts", "**/.next-e2e/**", "**/test-results/**", "**/playwright-report/**"],
  },
  js.configs.recommended,
  {
    // Node config files (next.config.mjs etc.).
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  ...tseslint.configs.recommended,
);
