/**
 * Emit the OpenAPI 3.1 document.
 *
 *   pnpm openapi:dump                 # prints JSON to stdout
 *   pnpm openapi:dump openapi.json    # writes the file (for RapidAPI/marketplace import)
 *
 * Boots a throwaway `wrangler dev`, fetches `/openapi.json`, and dumps it — so the spec
 * comes from the exact same zod schemas the runtime validates against and can never drift.
 * If BASE_URL is set, it fetches from there instead of booting wrangler.
 */

import { writeFileSync } from "node:fs"
import { withWrangler } from "./with-wrangler.js"

async function fetchDoc(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/openapi.json`)
  if (!res.ok) throw new Error(`openapi.json responded ${res.status}`)
  const doc = await res.json()
  return JSON.stringify(doc, null, 2)
}

function emit(json: string): void {
  const outPath = process.argv[2]
  if (outPath) {
    writeFileSync(outPath, `${json}\n`, "utf8")
    console.error(`Wrote ${outPath}`)
  } else {
    console.log(json)
  }
}

async function main(): Promise<void> {
  const json = process.env.BASE_URL
    ? await fetchDoc(process.env.BASE_URL)
    : await withWrangler(fetchDoc)
  emit(json)
}

void main()
