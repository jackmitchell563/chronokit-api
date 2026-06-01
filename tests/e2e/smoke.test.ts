import { type ChildProcess, spawn } from "node:child_process"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * End-to-end smoke test: boots a real `wrangler dev` instance and exercises the Worker
 * over HTTP, validating the production request path (routing, bundling, the actual
 * workerd runtime) — not just the in-process app. Kept out of the default `test` run
 * (see vitest.e2e.config.ts) because it is slower and needs wrangler.
 */

const HOST = "127.0.0.1"
const PORT = Number(process.env.E2E_PORT ?? 8799)
const BASE = `http://${HOST}:${PORT}`

let child: ChildProcess

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`wrangler dev not healthy in ${timeoutMs}ms: ${String(lastErr)}`)
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeAll(async () => {
  // Boot with proxy enforcement OFF: this suite validates routing, bundling, the workerd
  // runtime, and compute correctness — not the RapidAPI proxy gate (covered by its own
  // unit/integration tests). Production stays enforce=true via wrangler.toml; CI has no
  // .dev.vars, so we override explicitly here rather than depend on it.
  child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--ip",
      HOST,
      "--port",
      String(PORT),
      "--local",
      "--var",
      "ENFORCE_RAPIDAPI_PROXY:false",
    ],
    { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env } },
  )
  await waitForHealth(50_000)
}, 60_000)

afterAll(() => {
  if (child && !child.killed) child.kill("SIGTERM")
})

describe("E2E (wrangler dev over HTTP)", () => {
  it("GET /health is ok", async () => {
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe("ok")
  })

  it("serves the OpenAPI document", async () => {
    const res = await fetch(`${BASE}/openapi.json`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> }
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.paths["/v1/rrule/expand"]).toBeDefined()
  })

  it("expands an RRULE end-to-end with DST correctness", async () => {
    const { status, json } = await postJson("/v1/rrule/expand", {
      rrule: "FREQ=DAILY;COUNT=4",
      dtstart: "2026-03-07T09:00:00",
      tzid: "America/New_York",
    })
    expect(status).toBe(200)
    const occ = json.occurrences as string[]
    expect(occ[0]).toBe("2026-03-07T09:00:00.000-05:00")
    expect(occ[3]).toBe("2026-03-10T09:00:00.000-04:00")
  })

  it("computes cron next runs end-to-end", async () => {
    const { status, json } = await postJson("/v1/cron/next", {
      expression: "0 9 * * 1-5",
      tzid: "UTC",
      count: 2,
    })
    expect(status).toBe(200)
    expect((json.nextRuns as string[]).length).toBe(2)
  })

  it("computes business days end-to-end", async () => {
    const { status, json } = await postJson("/v1/business-days/calc", {
      start: "2026-03-06",
      mode: "add",
      days: 1,
    })
    expect(status).toBe(200)
    expect(json.result).toBe("2026-03-09")
  })

  it("returns a structured 400 on an unbounded rule", async () => {
    const { status, json } = await postJson("/v1/rrule/expand", {
      rrule: "FREQ=DAILY",
      dtstart: "2026-01-01T00:00:00",
    })
    expect(status).toBe(400)
    expect((json.error as { code: string }).code).toBe("unbounded_rule")
  })
})
