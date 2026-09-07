import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // `tsc` compiles __tests__ into dist/ too (rootDir is src/, and
    // tsconfig doesn't exclude tests from the build). Without this, vitest
    // picks up both the .ts sources and their compiled .js copies in dist/
    // and runs every test twice.
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      // src/index.ts just wires createApp() to app.listen() and is never
      // exercised directly -- every route/behavior it boots is what the
      // integration tests already cover via createApp() itself. seed.ts is
      // a dev-only data-generation script, not app logic.
      exclude: ["src/index.ts", "src/seed.ts", "**/__tests__/**", "vitest.setup.ts"],
    },
  },
});
