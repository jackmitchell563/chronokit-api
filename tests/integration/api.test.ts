import { beforeAll, describe, expect, it } from "vitest"
import { createApp } from "../../src/app.js"
import type { Env } from "../../src/env.js"
import { PROXY_SECRET_HEADER } from "../../src/middleware/proxy-secret.js"

const app = createApp()

/** Env with enforcement OFF (the local/demo default). */
const OPEN_ENV: Env = { ENFORCE_RAPIDAPI_PROXY: "false", MAX_RESULTS: "50" }

async function post(
  path: string,
  body: unknown,
  env: Env = OPEN_ENV,
  headers: Record<string, string> = {},
) {
  const res = await app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe("meta endpoints", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health", {}, OPEN_ENV)
    expect(res.status).toBe(200)
    const j = (await res.json()) as { status: string; version: string }
    expect(j.status).toBe("ok")
    expect(j.version).toBeDefined()
  })

  it("GET /openapi.json is a valid OpenAPI 3.1 document with all routes", async () => {
    const res = await app.request("/openapi.json", {}, OPEN_ENV)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> }
    expect(doc.openapi).toBe("3.1.0")
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/rrule/expand",
        "/v1/cron/next",
        "/v1/business-days/calc",
        "/health",
      ]),
    )
  })

  it("GET /docs serves Swagger UI", async () => {
    const res = await app.request("/docs", {}, OPEN_ENV)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")
  })

  it("GET / redirects to /docs", async () => {
    const res = await app.request("/", {}, OPEN_ENV)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/docs")
  })

  it("unknown route returns a structured 404", async () => {
    const res = await app.request("/v1/nope", { method: "POST" }, OPEN_ENV)
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe("not_found")
  })

  it("sets permissive CORS headers", async () => {
    const res = await app.request(
      "/v1/cron/next",
      {
        method: "OPTIONS",
        headers: { origin: "https://example.com", "access-control-request-method": "POST" },
      },
      OPEN_ENV,
    )
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })
})

describe("POST /v1/rrule/expand", () => {
  it("expands a simple rule", async () => {
    const { status, json } = await post("/v1/rrule/expand", {
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5",
      dtstart: "2026-03-02T09:00:00",
      tzid: "America/New_York",
      includeText: true,
    })
    expect(status).toBe(200)
    expect(json.count).toBe(5)
    expect(Array.isArray(json.occurrences)).toBe(true)
    expect(json.text).toBeDefined()
  })

  it("rejects providing neither rrule nor ruleSet (400 validation_error)", async () => {
    const { status, json } = await post("/v1/rrule/expand", { dtstart: "2026-03-02T09:00:00" })
    expect(status).toBe(400)
    expect((json.error as { code: string }).code).toBe("validation_error")
  })

  it("rejects providing both rrule and ruleSet", async () => {
    const { status } = await post("/v1/rrule/expand", {
      rrule: "FREQ=DAILY;COUNT=2",
      ruleSet: "RRULE:FREQ=DAILY;COUNT=2",
      dtstart: "2026-03-02T09:00:00",
    })
    expect(status).toBe(400)
  })

  it("rejects an unbounded rule with no window/count (400 unbounded_rule)", async () => {
    const { status, json } = await post("/v1/rrule/expand", {
      rrule: "FREQ=DAILY",
      dtstart: "2026-03-02T09:00:00",
    })
    expect(status).toBe(400)
    expect((json.error as { code: string }).code).toBe("unbounded_rule")
  })

  it("rejects an unknown timezone (400 invalid_timezone)", async () => {
    const { status, json } = await post("/v1/rrule/expand", {
      rrule: "FREQ=DAILY;COUNT=2",
      dtstart: "2026-03-02T09:00:00",
      tzid: "Mars/Phobos",
    })
    expect(status).toBe(400)
    expect((json.error as { code: string }).code).toBe("invalid_timezone")
  })

  it("rejects malformed RRULE (400 invalid_rrule)", async () => {
    const { status, json } = await post("/v1/rrule/expand", {
      rrule: "FREQ=BOGUS;COUNT=2",
      dtstart: "2026-03-02T09:00:00",
    })
    expect(status).toBe(400)
    expect((json.error as { code: string }).code).toBe("invalid_rrule")
  })

  it("defaults tzid to UTC when omitted", async () => {
    const { json } = await post("/v1/rrule/expand", {
      rrule: "FREQ=DAILY;COUNT=1",
      dtstart: "2026-06-01T12:00:00",
    })
    expect((json.occurrences as string[])[0]).toBe("2026-06-01T12:00:00.000Z")
  })
})

describe("POST /v1/cron/next", () => {
  it("returns next runs and a description", async () => {
    const { status, json } = await post("/v1/cron/next", {
      expression: "0 9 * * 1-5",
      tzid: "America/New_York",
      count: 3,
      includeDescription: true,
    })
    expect(status).toBe(200)
    expect(json.valid).toBe(true)
    expect((json.nextRuns as string[]).length).toBe(3)
    expect(json.description).toBeDefined()
  })

  it("returns valid:false (200) for a malformed expression", async () => {
    const { status, json } = await post("/v1/cron/next", { expression: "not a cron", count: 1 })
    expect(status).toBe(200)
    expect(json.valid).toBe(false)
    expect(json.error).toBeDefined()
  })

  it("returns valid:false (200) for an impossible-date expression (Feb 30)", async () => {
    // Syntactically valid yet unschedulable: must report valid:false, not a 400.
    const { status, json } = await post("/v1/cron/next", { expression: "0 0 30 2 *", count: 1 })
    expect(status).toBe(200)
    expect(json.valid).toBe(false)
    expect(json.error).toBeDefined()
  })

  it("uses the default count when omitted", async () => {
    const { json } = await post("/v1/cron/next", { expression: "@daily" })
    expect((json.nextRuns as string[]).length).toBe(5)
  })

  it("rejects an unknown timezone with a 400", async () => {
    const { status } = await post("/v1/cron/next", { expression: "@daily", tzid: "Nowhere/Here" })
    expect(status).toBe(400)
  })
})

describe("POST /v1/business-days/calc", () => {
  it("adds working days, skipping a holiday", async () => {
    const { status, json } = await post("/v1/business-days/calc", {
      start: "2026-03-06",
      mode: "add",
      days: 5,
      holidays: ["2026-03-09"],
    })
    expect(status).toBe(200)
    expect(json.result).toBe("2026-03-16")
  })

  it("counts working days in diff mode", async () => {
    const { json } = await post("/v1/business-days/calc", {
      start: "2026-03-02",
      mode: "diff",
      end: "2026-03-06",
    })
    expect(json.workingDays).toBe(4)
  })

  it("requires days for mode add (400)", async () => {
    const { status } = await post("/v1/business-days/calc", { start: "2026-03-06", mode: "add" })
    expect(status).toBe(400)
  })

  it("requires end for mode diff (400)", async () => {
    const { status } = await post("/v1/business-days/calc", { start: "2026-03-06", mode: "diff" })
    expect(status).toBe(400)
  })

  it("rejects a weekend mask of all seven days (400)", async () => {
    const { status } = await post("/v1/business-days/calc", {
      start: "2026-03-06",
      mode: "add",
      days: 1,
      weekend: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(status).toBe(400)
  })

  it("applies a default weekend of Sat/Sun when omitted", async () => {
    const { json } = await post("/v1/business-days/calc", {
      start: "2026-03-06",
      mode: "add",
      days: 1,
    })
    expect(json.result).toBe("2026-03-09") // Fri + 1 → Mon
    expect(json.weekend).toEqual([6, 7])
  })
})

describe("RapidAPI proxy-secret enforcement", () => {
  const ENFORCED: Env = {
    ENFORCE_RAPIDAPI_PROXY: "true",
    RAPIDAPI_PROXY_SECRET: "s3cr3t",
    MAX_RESULTS: "50",
  }

  beforeAll(() => {
    // sanity: the shared header name is what we send below
    expect(PROXY_SECRET_HEADER).toBe("X-RapidAPI-Proxy-Secret")
  })

  it("rejects a request missing the secret (401)", async () => {
    const { status, json } = await post("/v1/cron/next", { expression: "@daily" }, ENFORCED)
    expect(status).toBe(401)
    expect((json.error as { code: string }).code).toBe("unauthorized")
  })

  it("rejects a request with the wrong secret (401)", async () => {
    const { status } = await post("/v1/cron/next", { expression: "@daily" }, ENFORCED, {
      [PROXY_SECRET_HEADER]: "wrong",
    })
    expect(status).toBe(401)
  })

  it("allows a request with the correct secret", async () => {
    const { status } = await post("/v1/cron/next", { expression: "@daily" }, ENFORCED, {
      [PROXY_SECRET_HEADER]: "s3cr3t",
    })
    expect(status).toBe(200)
  })

  it("fails closed when enforcement is on but no secret is configured (401)", async () => {
    const MISCONFIG: Env = { ENFORCE_RAPIDAPI_PROXY: "true", MAX_RESULTS: "50" }
    const { status } = await post("/v1/cron/next", { expression: "@daily" }, MISCONFIG, {
      [PROXY_SECRET_HEADER]: "anything",
    })
    expect(status).toBe(401)
  })

  it("does not enforce on /health", async () => {
    const res = await app.request("/health", {}, ENFORCED)
    expect(res.status).toBe(200)
  })
})
