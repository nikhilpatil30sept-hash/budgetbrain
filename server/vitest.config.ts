import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // `tsc` compiles __tests__ into dist/ too (rootDir is src/, and
    // tsconfig doesn't exclude tests from the build). Without this, vitest
    // picks up both the .ts sources and their compiled .js copies in dist/
    // and runs every test twice.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
