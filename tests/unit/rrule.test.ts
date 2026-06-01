import { describe, expect, it } from "vitest"
import { parseWallClock } from "../../src/lib/datetime.js"
import { type ExpandInput, expandRecurrence } from "../../src/lib/rrule.js"

/** Helper: build an ExpandInput from a terse spec, parsing the wall-clock fields. */
function input(
  partial: Omit<ExpandInput, "dtstart" | "maxResults"> & { dtstart: string; maxResults?: number },
): ExpandInput {
  const { dtstart, between, maxResults, ...rest } = partial
  const out: ExpandInput = {
    ...rest,
    dtstart: parseWallClock(dtstart, "dtstart"),
    maxResults: maxResults ?? 50,
  }
  if (between) {
    out.between = {
      start: parseWallClock(between.start as unknown as string, "between.start"),
      end: parseWallClock(between.end as unknown as string, "between.end"),
    }
  }
  return out
}

/** Convenience: just the wall-clock prefix (YYYY-MM-DDTHH:mm) of each occurrence. */
function wall(occ: string[]): string[] {
  return occ.map((s) => s.slice(0, 16))
}

describe("expandRecurrence — basic frequencies", () => {
  it("DAILY with COUNT returns exactly COUNT occurrences", () => {
    const r = expandRecurrence(
      input({ rrule: "FREQ=DAILY;COUNT=3", dtstart: "2026-01-01T09:00:00", tzid: "UTC" }),
    )
    expect(r.count).toBe(3)
    expect(wall(r.occurrences)).toEqual([
      "2026-01-01T09:00",
      "2026-01-02T09:00",
      "2026-01-03T09:00",
    ])
    expect(r.truncated).toBe(false)
  })

  it("WEEKLY BYDAY=MO,WE,FR yields the right weekdays", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6",
        dtstart: "2026-03-02T09:00:00",
        tzid: "UTC",
      }),
    )
    // 2026-03-02 is a Monday.
    expect(wall(r.occurrences)).toEqual([
      "2026-03-02T09:00", // Mon
      "2026-03-04T09:00", // Wed
      "2026-03-06T09:00", // Fri
      "2026-03-09T09:00", // Mon
      "2026-03-11T09:00", // Wed
      "2026-03-13T09:00", // Fri
    ])
  })

  it("MONTHLY BYMONTHDAY=-1 yields month-end dates", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3",
        dtstart: "2026-01-31T12:00:00",
        tzid: "UTC",
      }),
    )
    expect(wall(r.occurrences)).toEqual([
      "2026-01-31T12:00",
      "2026-02-28T12:00",
      "2026-03-31T12:00",
    ])
  })

  it("INTERVAL skips periods", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;INTERVAL=3;COUNT=3",
        dtstart: "2026-01-01T00:00:00",
        tzid: "UTC",
      }),
    )
    expect(wall(r.occurrences)).toEqual([
      "2026-01-01T00:00",
      "2026-01-04T00:00",
      "2026-01-07T00:00",
    ])
  })

  it("UNTIL bounds the series", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;UNTIL=20260103T000000Z",
        dtstart: "2026-01-01T00:00:00",
        tzid: "UTC",
      }),
    )
    expect(r.count).toBe(3)
  })
})

describe("expandRecurrence — leap years", () => {
  it("YEARLY on Feb 29 only lands on leap years", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;COUNT=3",
        dtstart: "2024-02-29T00:00:00",
        tzid: "UTC",
      }),
    )
    // 2024, 2028, 2032 are leap years (2026/2027 skipped).
    expect(wall(r.occurrences)).toEqual([
      "2024-02-29T00:00",
      "2028-02-29T00:00",
      "2032-02-29T00:00",
    ])
  })
})

describe("expandRecurrence — DST correctness (the whole point)", () => {
  it("daily across US spring-forward keeps 09:00 local, flips offset -05:00 → -04:00", () => {
    // US DST starts 2026-03-08. DTSTART 2026-03-07 09:00.
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;COUNT=4",
        dtstart: "2026-03-07T09:00:00",
        tzid: "America/New_York",
      }),
    )
    expect(r.occurrences[0]).toBe("2026-03-07T09:00:00.000-05:00")
    expect(r.occurrences[1]).toBe("2026-03-08T09:00:00.000-04:00") // transition day, post-shift
    expect(r.occurrences[3]).toBe("2026-03-10T09:00:00.000-04:00")
  })

  it("daily across US fall-back keeps 09:00 local, flips offset -04:00 → -05:00", () => {
    // US DST ends 2026-11-01. DTSTART 2026-10-31 09:00.
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;COUNT=3",
        dtstart: "2026-10-31T09:00:00",
        tzid: "America/New_York",
      }),
    )
    expect(r.occurrences[0]).toBe("2026-10-31T09:00:00.000-04:00")
    expect(r.occurrences[1]).toBe("2026-11-01T09:00:00.000-05:00")
    expect(r.occurrences[2]).toBe("2026-11-02T09:00:00.000-05:00")
  })

  it("Europe/London transition (different date than US) handled independently", () => {
    // UK DST starts 2026-03-29.
    const r = expandRecurrence(
      input({ rrule: "FREQ=DAILY;COUNT=2", dtstart: "2026-03-28T12:00:00", tzid: "Europe/London" }),
    )
    expect(r.occurrences[0]).toBe("2026-03-28T12:00:00.000+00:00")
    expect(r.occurrences[1]).toBe("2026-03-29T12:00:00.000+01:00")
  })

  it("UTC tzid never shifts (rendered with canonical Z)", () => {
    const r = expandRecurrence(
      input({ rrule: "FREQ=DAILY;COUNT=2", dtstart: "2026-03-08T09:00:00", tzid: "UTC" }),
    )
    expect(r.occurrences[0]).toBe("2026-03-08T09:00:00.000Z")
    expect(r.occurrences[1]).toBe("2026-03-09T09:00:00.000Z")
  })
})

describe("expandRecurrence — rule sets (EXDATE / RDATE)", () => {
  it("EXDATE removes a matching occurrence", () => {
    const r = expandRecurrence(
      input({
        ruleSet: "RRULE:FREQ=DAILY;COUNT=6\nEXDATE:20260103T090000",
        dtstart: "2026-01-01T09:00:00",
        tzid: "UTC",
      }),
    )
    expect(r.count).toBe(5)
    expect(wall(r.occurrences)).not.toContain("2026-01-03T09:00")
  })

  it("RDATE adds an explicit extra occurrence", () => {
    const r = expandRecurrence(
      input({
        ruleSet: "RRULE:FREQ=DAILY;COUNT=2\nRDATE:20260601T090000",
        dtstart: "2026-01-01T09:00:00",
        tzid: "UTC",
      }),
    )
    expect(wall(r.occurrences)).toEqual([
      "2026-01-01T09:00",
      "2026-01-02T09:00",
      "2026-06-01T09:00",
    ])
  })

  it("rejects an embedded DTSTART line in ruleSet", () => {
    expect(() =>
      expandRecurrence(
        input({
          ruleSet: "DTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=2",
          dtstart: "2026-01-01T09:00:00",
          tzid: "UTC",
        }),
      ),
    ).toThrow(/DTSTART/)
  })
})

describe("expandRecurrence — windows", () => {
  it("between returns only occurrences in [start, end] inclusive", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;UNTIL=20261231T000000Z",
        dtstart: "2026-01-01T00:00:00",
        tzid: "UTC",
        between: {
          start: "2026-06-01T00:00:00",
          end: "2026-06-03T00:00:00",
        } as unknown as ExpandInput["between"],
      }),
    )
    expect(wall(r.occurrences)).toEqual([
      "2026-06-01T00:00",
      "2026-06-02T00:00",
      "2026-06-03T00:00",
    ])
  })

  it("rejects a window whose end precedes start", () => {
    expect(() =>
      expandRecurrence(
        input({
          rrule: "FREQ=DAILY;COUNT=10",
          dtstart: "2026-01-01T00:00:00",
          tzid: "UTC",
          between: {
            start: "2026-06-05T00:00:00",
            end: "2026-06-01T00:00:00",
          } as unknown as ExpandInput["between"],
        }),
      ),
    ).toThrow(/on or after/)
  })
})

describe("expandRecurrence — safety clamps", () => {
  it("rejects an unbounded rule with no window or count", () => {
    expect(() =>
      expandRecurrence(input({ rrule: "FREQ=DAILY", dtstart: "2026-01-01T00:00:00", tzid: "UTC" })),
    ).toThrow(/unbounded|COUNT\/UNTIL/i)
  })

  it("clamps a large requested count to maxResults and flags truncated", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;COUNT=1000",
        dtstart: "2026-01-01T00:00:00",
        tzid: "UTC",
        count: 500,
        maxResults: 50,
      }),
    )
    expect(r.count).toBe(50)
    expect(r.truncated).toBe(true)
  })

  it("an intrinsically bounded rule under the cap is not truncated", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;COUNT=10",
        dtstart: "2026-01-01T00:00:00",
        tzid: "UTC",
        maxResults: 50,
      }),
    )
    expect(r.count).toBe(10)
    expect(r.truncated).toBe(false)
  })

  it("an unbounded rule WITH a count is allowed and clamped", () => {
    const r = expandRecurrence(
      input({ rrule: "FREQ=DAILY", dtstart: "2026-01-01T00:00:00", tzid: "UTC", count: 5 }),
    )
    expect(r.count).toBe(5)
    expect(r.truncated).toBe(true)
  })

  it("throws invalid_rrule on garbage input", () => {
    expect(() =>
      expandRecurrence(
        input({ rrule: "FREQ=NONSENSE;COUNT=3", dtstart: "2026-01-01T00:00:00", tzid: "UTC" }),
      ),
    ).toThrow()
  })
})

describe("expandRecurrence — human-readable text", () => {
  it("includes text when requested", () => {
    const r = expandRecurrence(
      input({
        rrule: "FREQ=DAILY;COUNT=3",
        dtstart: "2026-01-01T09:00:00",
        tzid: "UTC",
        includeText: true,
      }),
    )
    expect(r.text).toMatch(/every day/i)
  })

  it("omits text by default", () => {
    const r = expandRecurrence(
      input({ rrule: "FREQ=DAILY;COUNT=3", dtstart: "2026-01-01T09:00:00", tzid: "UTC" }),
    )
    expect(r.text).toBeUndefined()
  })
})
