/**
 * Shared demo driver: exercises every endpoint of a RUNNING ChronoKit instance and
 * pretty-prints the results. Used by both `pnpm seed` (which boots wrangler for you)
 * and anyone wanting to point it at an already-running server via BASE_URL.
 *
 * It is pure HTTP — it does not import the Worker code — so it validates the real
 * request/response contract exactly as a customer would experience it.
 */

const GREEN = "\x1b[32m"
const CYAN = "\x1b[36m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

export interface DemoCase {
  title: string
  method: "GET" | "POST"
  path: string
  body?: unknown
  /** Optional assertion; throw to fail the demo. Receives parsed JSON + status. */
  check?: (status: number, json: unknown) => void
}

/** The curated tour of capabilities, doubling as living documentation. */
export const DEMO_CASES: DemoCase[] = [
  {
    title: "Health check",
    method: "GET",
    path: "/health",
    check: (status, json) => {
      const j = json as { status?: string }
      if (status !== 200 || j.status !== "ok") throw new Error("health not ok")
    },
  },
  {
    title: "RRULE — every Mon/Wed/Fri, 5 times, in New York (with text)",
    method: "POST",
    path: "/v1/rrule/expand",
    body: {
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5",
      dtstart: "2026-03-02T09:00:00",
      tzid: "America/New_York",
      includeText: true,
    },
    check: (status, json) => {
      const j = json as { count?: number }
      if (status !== 200 || j.count !== 5) throw new Error("expected 5 occurrences")
    },
  },
  {
    title: "RRULE — daily across US spring-forward (offset flips -05:00 → -04:00)",
    method: "POST",
    path: "/v1/rrule/expand",
    body: {
      rrule: "FREQ=DAILY;COUNT=4",
      dtstart: "2026-03-07T09:00:00",
      tzid: "America/New_York",
    },
    check: (status, json) => {
      const occ = (json as { occurrences?: string[] }).occurrences ?? []
      // Mar 7 is -05:00, Mar 9 (after the Mar 8 transition) is -04:00; wall time stays 09:00.
      if (
        status !== 200 ||
        !occ[0]?.includes("09:00:00.000-05:00") ||
        !occ[3]?.includes("09:00:00.000-04:00")
      ) {
        throw new Error("DST offset flip not observed")
      }
    },
  },
  {
    title: "RRULE — rule set with EXDATE (one date excluded) inside a window",
    method: "POST",
    path: "/v1/rrule/expand",
    body: {
      ruleSet: "RRULE:FREQ=DAILY;COUNT=6\nEXDATE:20260103T090000",
      dtstart: "2026-01-01T09:00:00",
      tzid: "UTC",
    },
    check: (status, json) => {
      const j = json as { count?: number }
      if (status !== 200 || j.count !== 5) throw new Error("EXDATE not applied (expected 5)")
    },
  },
  {
    title: "Cron — next 3 runs of weekday 09:00 in New York (with description)",
    method: "POST",
    path: "/v1/cron/next",
    body: {
      expression: "0 9 * * 1-5",
      tzid: "America/New_York",
      count: 3,
      includeDescription: true,
    },
    check: (status, json) => {
      const j = json as { valid?: boolean; nextRuns?: string[] }
      if (status !== 200 || j.valid !== true || (j.nextRuns ?? []).length !== 3)
        throw new Error("cron runs wrong")
    },
  },
  {
    title: "Cron — macro @daily next 2 runs",
    method: "POST",
    path: "/v1/cron/next",
    body: { expression: "@daily", count: 2 },
    check: (status, json) => {
      if (status !== 200 || (json as { nextRuns?: string[] }).nextRuns?.length !== 2)
        throw new Error("macro failed")
    },
  },
  {
    title: "Cron — invalid expression returns valid:false (validator mode)",
    method: "POST",
    path: "/v1/cron/next",
    body: { expression: "not a cron", count: 1 },
    check: (status, json) => {
      if (status !== 200 || (json as { valid?: boolean }).valid !== false)
        throw new Error("expected valid:false")
    },
  },
  {
    title: "Business days — add 5 working days, skipping a holiday (Mon 2026-03-09)",
    method: "POST",
    path: "/v1/business-days/calc",
    body: { start: "2026-03-06", mode: "add", days: 5, holidays: ["2026-03-09"] },
    check: (status, json) => {
      // Fri 3/6 +5 working days, with Mon 3/9 a holiday → lands on Mon 3/16.
      if (status !== 200 || (json as { result?: string }).result !== "2026-03-16")
        throw new Error("add result wrong")
    },
  },
  {
    title: "Business days — diff with Gulf weekend (Fri+Sat = [5,6])",
    method: "POST",
    path: "/v1/business-days/calc",
    body: { start: "2026-03-01", mode: "diff", end: "2026-03-15", weekend: [5, 6] },
    check: (status, json) => {
      if (status !== 200 || typeof (json as { workingDays?: number }).workingDays !== "number") {
        throw new Error("diff failed")
      }
    },
  },
  {
    title: "Validation — unbounded RRULE with no window/count is rejected (400)",
    method: "POST",
    path: "/v1/rrule/expand",
    body: { rrule: "FREQ=DAILY", dtstart: "2026-01-01T09:00:00" },
    check: (status, json) => {
      if (
        status !== 400 ||
        (json as { error?: { code?: string } }).error?.code !== "unbounded_rule"
      ) {
        throw new Error("expected unbounded_rule 400")
      }
    },
  },
]

export interface DemoOutcome {
  passed: number
  failed: number
}

/** Run the demo tour against `baseUrl`. Logs each case; returns pass/fail tallies. */
export async function runDemo(
  baseUrl: string,
  log: (s: string) => void = console.log,
): Promise<DemoOutcome> {
  log(`${BOLD}ChronoKit API — live demo${RESET} ${DIM}(${baseUrl})${RESET}\n`)
  let passed = 0
  let failed = 0

  for (const c of DEMO_CASES) {
    const init: RequestInit = { method: c.method, headers: { "content-type": "application/json" } }
    if (c.body !== undefined) init.body = JSON.stringify(c.body)

    try {
      const res = await fetch(`${baseUrl}${c.path}`, init)
      const json = await res.json()
      c.check?.(res.status, json)
      passed++
      log(`${GREEN}✓${RESET} ${c.title}`)
      log(`${DIM}  ${c.method} ${c.path} → ${res.status}${RESET}`)
      log(`${CYAN}  ${JSON.stringify(json)}${RESET}\n`)
    } catch (err) {
      failed++
      log(`${RED}✗ ${c.title}${RESET}`)
      log(`${RED}  ${err instanceof Error ? err.message : String(err)}${RESET}\n`)
    }
  }

  log(
    `${BOLD}Result:${RESET} ${GREEN}${passed} passed${RESET}${failed ? `, ${RED}${failed} failed${RESET}` : ""}`,
  )
  return { passed, failed }
}
