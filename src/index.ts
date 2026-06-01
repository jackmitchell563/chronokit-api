/**
 * Cloudflare Workers entry point for ChronoKit API.
 *
 * The app is constructed once per isolate (module scope) and reused across requests —
 * it is stateless, so this is safe and fast. Hono's app exposes a `fetch` handler that
 * matches the Workers module-worker contract.
 */

import { createApp } from "./app.js"
import type { Env } from "./env.js"

const app = createApp()

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
