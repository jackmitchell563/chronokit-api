import { describe, expect, it } from "vitest"
import {
  type AddResult,
  computeBusinessDays,
  type DiffResult,
} from "../../src/lib/business-days.js"

function add(
  start: string,
  days: number,
  weekend: number[] = [6, 7],
  holidays: string[] = [],
): string {
  const r = computeBusinessDays({ mode: "add", start, days, weekend, holidays }) as AddResult
  return r.result
}

function diff(
  start: string,
  end: string,
  weekend: number[] = [6, 7],
  holidays: string[] = [],
): number {
  const r = computeBusinessDays({ mode: "diff", start, end, weekend, holidays }) as DiffResult
  return r.workingDays
}

describe("business-days — add (default Sat/Sun weekend)", () => {
  it("adds working days within a week", () => {
    // Mon 2026-03-02 + 3 working days = Thu 2026-03-05.
    expect(add("2026-03-02", 3)).toBe("2026-03-05")
  })

  it("skips the weekend", () => {
    // Fri 2026-03-06 + 1 working day = Mon 2026-03-09 (Sat/Sun skipped).
    expect(add("2026-03-06", 1)).toBe("2026-03-09")
  })

  it("days=0 returns the start date unchanged (even on a weekend)", () => {
    expect(add("2026-03-07", 0)).toBe("2026-03-07") // a Saturday
  })

  it("subtracts working days with a negative offset", () => {
    // Mon 2026-03-09 - 1 working day = Fri 2026-03-06.
    expect(add("2026-03-09", -1)).toBe("2026-03-06")
  })

  it("excludes caller-supplied holidays", () => {
    // Fri 3/6 + 5 working days, Mon 3/9 holiday → Tue 3/10 .. lands Mon 3/16.
    expect(add("2026-03-06", 5, [6, 7], ["2026-03-09"])).toBe("2026-03-16")
  })
})

describe("business-days — add (Gulf weekend Fri/Sat = [5,6])", () => {
  it("treats Fri/Sat as the weekend", () => {
    // Thu 2026-03-05 + 1 working day, Fri+Sat off → Sun 2026-03-08.
    expect(add("2026-03-05", 1, [5, 6])).toBe("2026-03-08")
  })
})

describe("business-days — diff", () => {
  it("counts working days in a forward span (half-open: excludes start, includes end)", () => {
    // Mon 3/2 → Fri 3/6: working days after start = Tue,Wed,Thu,Fri = 4.
    expect(diff("2026-03-02", "2026-03-06")).toBe(4)
  })

  it("returns 0 for equal dates", () => {
    expect(diff("2026-03-02", "2026-03-02")).toBe(0)
  })

  it("excludes holidays from the count", () => {
    // Mon 3/2 → Fri 3/6 with Wed 3/4 holiday → 3 working days.
    expect(diff("2026-03-02", "2026-03-06", [6, 7], ["2026-03-04"])).toBe(3)
  })

  it("is signed (negative) when end precedes start", () => {
    expect(diff("2026-03-06", "2026-03-02")).toBe(-4)
  })

  it("is the inverse of add: diff(start, add(start, n)) === n", () => {
    const start = "2026-03-02"
    const holidays = ["2026-03-12"]
    for (const n of [1, 5, 10, 23]) {
      const end = add(start, n, [6, 7], holidays)
      expect(diff(start, end, [6, 7], holidays)).toBe(n)
    }
  })
})

describe("business-days — validation & clamps", () => {
  it("rejects a weekend mask covering all seven days", () => {
    expect(() =>
      computeBusinessDays({
        mode: "add",
        start: "2026-03-02",
        days: 1,
        weekend: [1, 2, 3, 4, 5, 6, 7],
        holidays: [],
      }),
    ).toThrow(/seven days/)
  })

  it("rejects an invalid weekday number", () => {
    expect(() =>
      computeBusinessDays({
        mode: "add",
        start: "2026-03-02",
        days: 1,
        weekend: [0],
        holidays: [],
      }),
    ).toThrow(/1–7/)
  })

  it("rejects a non-integer offset", () => {
    expect(() =>
      computeBusinessDays({
        mode: "add",
        start: "2026-03-02",
        days: 1.5,
        weekend: [6, 7],
        holidays: [],
      }),
    ).toThrow(/integer/)
  })

  it("rejects an absurdly large offset", () => {
    expect(() =>
      computeBusinessDays({
        mode: "add",
        start: "2026-03-02",
        days: 10_000_000,
        weekend: [6, 7],
        holidays: [],
      }),
    ).toThrow(/limit/)
  })

  it("rejects a malformed holiday date", () => {
    expect(() =>
      computeBusinessDays({
        mode: "add",
        start: "2026-03-02",
        days: 1,
        weekend: [6, 7],
        holidays: ["not-a-date"],
      }),
    ).toThrow()
  })

  it("handles a long but legal span across a leap day", () => {
    // 2028 is a leap year; just assert it computes a number without throwing.
    expect(typeof diff("2027-01-01", "2029-01-01")).toBe("number")
  })
})
