import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "supabase/functions/**",
    // Generated report output, not source. Without this, `npm test --coverage`
    // leaves minified vendor bundles in coverage/ whose bundled eslint-disable
    // directives trip `--max-warnings 0` and block every commit.
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
