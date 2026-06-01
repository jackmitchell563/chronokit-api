import { defineConfig } from "vitest/config"

// E2E / smoke suite: boots `wrangler dev` and hits the worker over real HTTP.
// Kept separate so unit/integration runs stay fast and hermetic. A longer
// timeout accommodates the wrangler cold start.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Workers dev server is a shared resource; run E2E files serially.
    fileParallelism: false,
  },
})
