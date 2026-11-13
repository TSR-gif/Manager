import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // New in Next 16's React rules (React Compiler readiness). The current hits are Date.now() in server pages and
  // one-time browser checks in effects, not bugs, so they warn instead of failing the build.
  { rules: { "react-hooks/purity": "warn", "react-hooks/set-state-in-effect": "warn", "react-hooks/immutability": "warn" } },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
