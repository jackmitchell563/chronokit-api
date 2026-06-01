import { describe, expect, it } from "vitest"
import { describeCron, nextCronRuns } from "../../src/lib/cron.js"

const FROM = new Date("2026-03-02T00:00:00Z") // a Monday, before US DST

describe("nextCronRuns — basics", () => {
  it("computes weekday 09:00 runs (5-field)", () => {
    const r = nextCronRuns({
      expression: "0 9 * * 1-5",
      tzid: "UTC",
      count: 3,
      from: FROM,
      maxResults: 50,
    })
    expect(r.valid).toBe(true)
    expect(r.nextRuns).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z",
    ])
  })

  it("supports macros (@daily)", () => {
    const r = nextCronRuns({
      expression: "@daily",
      tzid: "UTC",
      count: 2,
      from: FROM,
      maxResults: 50,
    })
    expect(r.nextRuns).toEqual(["2026-03-03T00:00:00.000Z", "2026-03-04T00:00:00.000Z"])
  })

  it("supports 6-field expressions with seconds", () => {
    const r = nextCronRuns({
      expression: "*/30 * * * * *",
      tzid: "UTC",
      count: 2,
      from: new Date("2026-03-02T00:00:00Z"),
      maxResults: 50,
    })
    expect(r.nextRuns).toEqual(["2026-03-02T00:00:30.000Z", "2026-03-02T00:01:00.000Z"])
  })

  it("clamps count to maxResults", () => {
    const r = nextCronRuns({
      expression: "* * * * *",
      tzid: "UTC",
      count: 100,
      from: FROM,
      maxResults: 5,
    })
    expect(r.nextRuns).toHaveLength(5)
    expect(r.count).toBe(5)
  })
})

describe("nextCronRuns — timezone & DST", () => {
  it("renders runs in the target zone with the correct offset", () => {
    const r = nextCronRuns({
      expression: "0 9 * * *",
      tzid: "America/New_York",
      count: 1,
      from: new Date("2026-03-02T00:00:00Z"),
      maxResults: 50,
    })
    expect(r.nextRuns[0]).toBe("2026-03-02T09:00:00.000-05:00")
  })

  it("crosses US spring-forward: 09:00 local before and after, offset flips", () => {
    // From just before the 2026-03-08 transition; weekday 9am.
    const r = nextCronRuns({
      expression: "0 9 * * 1-5",
      tzid: "America/New_York",
      count: 5,
      from: new Date("2026-03-05T20:00:00Z"),
      maxResults: 50,
    })
    // Fri 3/6 is -05:00; Mon 3/9 (after transition) is -04:00.
    expect(r.nextRuns[0]).toBe("2026-03-06T09:00:00.000-05:00")
    expect(r.nextRuns[1]).toBe("2026-03-09T09:00:00.000-04:00")
  })
})

describe("nextCronRuns — invalid input", () => {
  it("throws on a malformed expression", () => {
    expect(() =>
      nextCronRuns({ expression: "not a cron", tzid: "UTC", count: 1, from: FROM, maxResults: 50 }),
    ).toThrow()
  })

  it("rejects an out-of-range field", () => {
    expect(() =>
      nextCronRuns({ expression: "99 * * * *", tzid: "UTC", count: 1, from: FROM, maxResults: 50 }),
    ).toThrow()
  })
})

describe("describeCron", () => {
  it("describes a valid expression in English", () => {
    const d = describeCron("0 9 * * 1-5")
    expect(d.valid).toBe(true)
    expect(d.description?.toLowerCase()).toContain("09:00")
  })

  it("flags an invalid expression without throwing, with a clean message", () => {
    const d = describeCron("not a cron")
    expect(d.valid).toBe(false)
    expect(d.error).toBeDefined()
    // The raw "Error: " prefix from cronstrue is stripped for a clean API message.
    expect(d.error).not.toMatch(/^Error:/)
  })

  it("flags a syntactically-valid but impossible-date expression as invalid", () => {
    // cronstrue describes "Feb 30" happily, but cron-parser can never schedule it.
    // describeCron must probe both engines so the validator contract stays consistent.
    const d = describeCron("0 0 30 2 *")
    expect(d.valid).toBe(false)
    expect(d.error).toBeDefined()
  })

  it("includes a description in the run result when requested", () => {
    const r = nextCronRuns({
      expression: "0 9 * * 1-5",
      tzid: "UTC",
      count: 1,
      from: FROM,
      maxResults: 50,
      includeDescription: true,
    })
    expect(r.description).toBeDefined()
  })
})
