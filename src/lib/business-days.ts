/**
 * Business-day (working-day) arithmetic — pure, in-house, no bundled data.
 *
 * Two modes:
 *  - "add":  given a start date and an integer offset (±N), return the date that is N
 *            working days away (forward for N>0, backward for N<0).
 *  - "diff": given a start and end date, count the working days in between.
 *
 * "Working day" = a day that is neither in the weekend mask nor in the caller-supplied
 * holiday list. The CALLER owns the holiday data (passed as an input array), so no
 * holiday dataset is bundled — sidestepping all licensing/maintenance burden (see SPEC).
 *
 * Weekend mask uses ISO weekday numbers: 1=Mon … 7=Sun. Default [6, 7] = Sat+Sun.
 * For Gulf locales pass [5, 6] (Fri+Sat).
 *
 * All dates are handled as zone-free calendar dates (midnight UTC) so DST never distorts
 * the day count — a "day" here is a calendar day, not a 24h instant.
 */

import type { DateTime } from "luxon"
import { ApiError } from "../errors.js"
import { formatCalendarDate, parseCalendarDate } from "./datetime.js"

/** Defensive ceiling on offset/iteration so a huge N can't spin the CPU. */
export const MAX_BUSINESS_DAY_OFFSET = 100_000
/** Defensive ceiling on the diff span (in calendar days) to bound iteration. */
export const MAX_DIFF_SPAN_DAYS = 366 * 200 // ~200 years

export interface AddInput {
  mode: "add"
  start: string
  days: number
  weekend: number[]
  holidays: string[]
}

export interface DiffInput {
  mode: "diff"
  start: string
  end: string
  weekend: number[]
  holidays: string[]
}

export type BusinessDayInput = AddInput | DiffInput

export interface AddResult {
  mode: "add"
  /** Resulting calendar date "YYYY-MM-DD". */
  result: string
  /** Echo of the effective weekend mask used. */
  weekend: number[]
}

export interface DiffResult {
  mode: "diff"
  /** Count of working days. Signed: negative if end precedes start. */
  workingDays: number
  weekend: number[]
}

export type BusinessDayResult = AddResult | DiffResult

/** Build a fast lookup set of holiday calendar dates ("YYYY-MM-DD"), validating each. */
function holidaySet(holidays: string[]): Set<string> {
  const set = new Set<string>()
  for (const h of holidays) {
    // Normalize through the calendar-date parser so "2026-1-1" etc. are rejected/canonicalized.
    const dt = parseCalendarDate(h, "holidays[]")
    set.add(formatCalendarDate(dt))
  }
  return set
}

/** A day is "working" iff its ISO weekday is not masked and it is not a holiday. */
function isWorkingDay(dt: DateTime, weekendMask: Set<number>, holidays: Set<string>): boolean {
  if (weekendMask.has(dt.weekday)) return false
  if (holidays.has(formatCalendarDate(dt))) return false
  return true
}

/** Reject a weekend mask that swallows the entire week (would make "add" loop forever). */
function validateWeekend(weekend: number[]): Set<number> {
  for (const d of weekend) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw ApiError.badRequest(
        "validation_error",
        `"weekend" entries must be ISO weekday integers 1–7 (1=Mon … 7=Sun); got ${JSON.stringify(d)}.`,
      )
    }
  }
  const mask = new Set(weekend)
  if (mask.size >= 7) {
    throw ApiError.badRequest(
      "validation_error",
      '"weekend" cannot include all seven days — there would be no working days.',
    )
  }
  return mask
}

export function computeBusinessDays(input: BusinessDayInput): BusinessDayResult {
  const weekendMask = validateWeekend(input.weekend)
  const holidays = holidaySet(input.holidays)

  if (input.mode === "add") {
    return computeAdd(input, weekendMask, holidays)
  }
  return computeDiff(input, weekendMask, holidays)
}

function computeAdd(input: AddInput, weekendMask: Set<number>, holidays: Set<string>): AddResult {
  if (!Number.isInteger(input.days)) {
    throw ApiError.badRequest("validation_error", '"days" must be an integer for mode "add".')
  }
  if (Math.abs(input.days) > MAX_BUSINESS_DAY_OFFSET) {
    throw ApiError.badRequest(
      "validation_error",
      `"days" magnitude exceeds the limit of ${MAX_BUSINESS_DAY_OFFSET}.`,
    )
  }

  let cursor = parseCalendarDate(input.start, "start")
  const step = input.days >= 0 ? 1 : -1
  let remaining = Math.abs(input.days)

  // Step day-by-day, counting only working days. With days=0 the start date is returned
  // unchanged (even if start itself is a weekend/holiday — "0 working days away" = itself).
  while (remaining > 0) {
    cursor = cursor.plus({ days: step })
    if (isWorkingDay(cursor, weekendMask, holidays)) {
      remaining -= 1
    }
  }

  return { mode: "add", result: formatCalendarDate(cursor), weekend: input.weekend }
}

function computeDiff(
  input: DiffInput,
  weekendMask: Set<number>,
  holidays: Set<string>,
): DiffResult {
  const start = parseCalendarDate(input.start, "start")
  const end = parseCalendarDate(input.end, "end")

  const spanDays = Math.abs(end.diff(start, "days").days)
  if (spanDays > MAX_DIFF_SPAN_DAYS) {
    throw ApiError.badRequest(
      "validation_error",
      `The span between "start" and "end" exceeds the limit of ${MAX_DIFF_SPAN_DAYS} days.`,
    )
  }

  // Count working days in the half-open interval (start, end] when end > start, and
  // negate for the reverse direction. This makes diff the exact inverse of add:
  // add(start, n) = d  ⇒  diff(start, d) = n.
  const forward = end.toMillis() >= start.toMillis()
  const lo = forward ? start : end
  const hi = forward ? end : start

  let count = 0
  let cursor = lo
  while (cursor.toMillis() < hi.toMillis()) {
    cursor = cursor.plus({ days: 1 })
    if (isWorkingDay(cursor, weekendMask, holidays)) count += 1
  }

  return { mode: "diff", workingDays: forward ? count : -count, weekend: input.weekend }
}
