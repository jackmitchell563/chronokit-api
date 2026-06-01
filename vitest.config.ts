import { defineConfig } from "vitest/config"

// Unit + integration tests run in the default Node pool. The Hono app is
// binding-free (no KV/D1), so `app.request()` exercises the real routing,
// validation, and compute exactly as it runs on Workers — without the overhead
// or version-coupling of the workerd test pool. The E2E suite (vitest.e2e.config.ts)
// covers true HTTP behavior against a live `wrangler dev` instance.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
})
