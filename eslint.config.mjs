// Flat config (ESLint 9). One shared config for the whole monorepo rather
// than a separate config per workspace -- server and client only really
// differ in which globals (Node vs browser) and which React-specific rules
// apply, which the `files` glob on each block below handles.
//
// Deliberately a *baseline*, not maximally strict: typescript-eslint's
// non-type-checked `recommended` preset (fast, no tsconfig project service
// needed) rather than `recommended-type-checked`, and unused-vars is a
// warning (with an `_`-prefix escape hatch) rather than an error, so the
// lint step catches real mistakes without becoming a second, stricter
// compiler on day one.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "e2e/playwright-report/**",
      "e2e/test-results/**",
      "client/src/vite-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everywhere: unused-vars as a warning (not an error), with an
    // underscore-prefix escape hatch for intentionally-unused params
    // (common in Express handlers that don't use `req`, or destructuring
    // that skips a value). Base `no-undef` is turned off per
    // typescript-eslint's own guidance -- TypeScript already catches
    // genuinely undefined identifiers, and the un-type-aware base rule
    // throws false positives on things like `import.meta.env` and
    // TS-only ambient/global types.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-undef": "off",
    },
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // Test files (both workspaces) and the e2e suite: mocking and fixture
    // setup legitimately reach for `any` more than production code should.
    files: [
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "e2e/tests/**",
      "**/vitest.setup.ts",
      "**/test-setup.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
