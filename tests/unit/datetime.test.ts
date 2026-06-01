import { describe, expect, it } from "vitest"
import {
  formatCalendarDate,
  parseCalendarDate,
  parseWallClock,
  validateTimezone,
  zonedFromFloating,
} from "../../src/lib/datetime.js"

describe("validateTimezone", () => {
  it("accepts valid IANA zones", () => {
    expect(validateTimezone("America/New_York")).toBe("America/New_York")
    expect(validateTimezone("UTC")).toBe("UTC")
    expect(validateTimezone("Asia/Dubai")).toBe("Asia/Dubai")
  })

  it("rejects unknown zones", () => {
    expect(() => validateTimezone("Mars/Olympus")).toThrow(/timezone/i)
    expect(() => validateTimezone("EST5EDT-bogus")).toThrow()
  })
})

describe("parseWallClock", () => {
  it("reads calendar fields verbatim and ignores any offset", () => {
    const a = parseWallClock("2026-03-08T09:30:15", "x")
    expect(a).toMatchObject({ year: 2026, month: 3, day: 8, hour: 9, minute: 30, second: 15 })
    // Offset is intentionally discarded — wall time is preserved.
    const b = parseWallClock("2026-03-08T09:30:00+05:00", "x")
    expect(b).toMatchObject({ hour: 9, minute: 30 })
  })

  it("accepts a bare date as midnight", () => {
    expect(parseWallClock("2026-03-08", "x")).toMatchObject({
      year: 2026,
      month: 3,
      day: 8,
      hour: 0,
    })
  })

  it("throws on unparseable input", () => {
    expect(() => parseWallClock("nonsense", "x")).toThrow(/Invalid/)
  })
})

describe("zonedFromFloating", () => {
  it("re-anchors a floating date into the target zone with the right offset", () => {
    const floating = new Date(Date.UTC(2026, 2, 9, 9, 0, 0)) // wall 2026-03-09 09:00
    expect(zonedFromFloating(floating, "America/New_York")).toBe("2026-03-09T09:00:00.000-04:00")
    expect(zonedFromFloating(floating, "UTC")).toBe("2026-03-09T09:00:00.000Z")
  })
})

describe("calendar date helpers", () => {
  it("round-trips a date through parse/format", () => {
    expect(formatCalendarDate(parseCalendarDate("2026-12-25", "x"))).toBe("2026-12-25")
  })

  it("rejects an invalid calendar date", () => {
    expect(() => parseCalendarDate("2026-13-40", "x")).toThrow(/Invalid/)
  })
})
