/**
 * One-command local demo: `pnpm seed`.
 *
 * Boots `wrangler dev`, waits for `/health`, runs the full capability tour
 * (scripts/demo.ts) over real HTTP, prints results, then shuts down. Exits non-zero if
 * any case fails, so it doubles as a fast end-to-end check.
 *
 * If BASE_URL is set, it skips booting wrangler and runs the tour against that URL
 * (useful for hitting an already-running or deployed instance).
 */

import { runDemo } from "./demo.js"
import { withWrangler } from "./with-wrangler.js"

async function main(): Promise<void> {
  if (process.env.BASE_URL) {
    const { failed } = await runDemo(process.env.BASE_URL)
    process.exit(failed > 0 ? 1 : 0)
  }

  console.log("Starting wrangler dev for the demo …\n")
  let code = 0
  try {
    const { failed } = await withWrangler((baseUrl) => runDemo(baseUrl))
    code = failed > 0 ? 1 : 0
  } catch (err) {
    console.error(`Demo failed: ${err instanceof Error ? err.message : String(err)}`)
    code = 1
  }
  process.exit(code)
}

void main()
