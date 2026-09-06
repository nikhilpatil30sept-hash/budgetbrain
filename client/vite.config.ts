/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    port: 5173,
    proxy: {
      // All API traffic goes to the Express server; the Gemini key never
      // exists on this side of the proxy.
      "/api": "http://localhost:3001",
    },
  },
});
