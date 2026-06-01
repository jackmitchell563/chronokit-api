/**
 * Timezone + DST plumbing built on luxon.
 *
 * The recurring-events problem is hard almost entirely because of timezones and DST.
 * `rrule` deliberately computes in a "floating" frame: it treats DTSTART as a naive
 * wall-clock time and produces JS `Date`s whose UTC components ARE the wall-clock
 * components (e.g. UTC 09:00 means "09:00 local, whatever the offset is that day").
 *
 * To make results DST-correct in a real IANA zone, we:
 *   1. Parse the caller's DTSTART/window as naive wall-clock (ignoring any offset/Z),
 *      because RRULE semantics are defined on local wall time (RFC 5545 §3.3.5).
 *   2. Feed naive wall-clock into rrule.
 *   3. Re-anchor each floating result into the target zone via {@link zonedFromFloating},
 *      which picks the correct UTC offset for that specific date — so 09:00 local stays
 *      09:00 local across spring-forward/fall-back, and the emitted ISO carries the right
 *      offset (-05:00 → -04:00).
 *
 * All helpers here are pure and total: they return typed results or throw {@link ApiError}.
 */

import { DateTime } from "luxon"
import { ApiError } from "../errors.js"

/** A naive wall-clock instant: calendar fields with no zone/offset attached. */
export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/**
 * Validate an IANA timezone identifier (e.g. "America/New_York", "Europe/London").
 * Returns the canonical id, or throws `invalid_timezone`. "UTC" is always valid.
 */
export function validateTimezone(tzid: string): string {
  const dt = DateTime.now().setZone(tzid)
  if (!dt.isValid) {
    throw ApiError.badRequest(
      "invalid_timezone",
      `Unknown IANA timezone identifier: "${tzid}". Use names like "America/New_York" or "UTC".`,
    )
  }
  return tzid
}

/**
 * Parse a caller-supplied datetime string into naive wall-clock fields.
 *
 * Accepts ISO 8601 with or without an offset/`Z`. Any offset is intentionally
 * DISCARDED — RRULE expansion is defined on local wall time, and the zone is supplied
 * separately via `tzid`. This keeps "DTSTART 09:00 + tzid Europe/Paris" unambiguous.
 *
 * Also accepts a bare date ("2026-03-08"), interpreted as midnight wall time.
 */
export function parseWallClock(input: string, field: string): WallClock {
  // setZone:true parses the value in ITS OWN declared zone (or UTC if none), so the
  // local calendar fields we read back are verbatim what the caller wrote — any offset
  // is effectively discarded rather than converted. RRULE wall time is then unambiguous.
  const dt = DateTime.fromISO(input, { setZone: true })
  if (!dt.isValid) {
    throw ApiError.badRequest(
      "invalid_date",
      `Invalid ISO 8601 datetime for "${field}": ${JSON.stringify(input)} (${dt.invalidReason ?? "unparseable"}).`,
    )
  }
  return {
    year: dt.year,
    month: dt.month,
    day: dt.day,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second,
  }
}

/**
 * Build the floating `Date` that rrule expects from naive wall-clock fields:
 * a `Date` whose UTC components equal the wall-clock components.
 */
export function floatingDateFromWallClock(wc: WallClock): Date {
  return new Date(Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second))
}

/**
 * Inverse of {@link floatingDateFromWallClock}: read a floating `Date`'s UTC components
 * as wall-clock fields.
 */
export function wallClockFromFloating(d: Date): WallClock {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  }
}

/**
 * Re-anchor a floating rrule `Date` into a real IANA zone, choosing the correct offset
 * for that calendar date. Returns an offset-aware ISO 8601 string.
 *
 * Handles DST gaps/overlaps gracefully:
 *  - Spring-forward gap (e.g. 02:30 on the skip day): luxon advances to the valid instant.
 *  - Fall-back overlap: luxon resolves to the first (pre-transition) occurrence.
 * Both are standard, documented luxon behaviors and match how calendar apps render them.
 */
export function zonedFromFloating(d: Date, tzid: string): string {
  const dt = DateTime.fromObject(wallClockFromFloating(d), { zone: tzid })
  // fromObject only becomes invalid for an unknown zone, which we validate upstream;
  // guard anyway so a bad path surfaces as a clean error rather than "Invalid DateTime".
  if (!dt.isValid) {
    throw ApiError.badRequest("invalid_timezone", `Cannot resolve time in zone "${tzid}".`)
  }
  // includeOffset:true yields e.g. 2026-03-09T09:00:00.000-04:00
  return dt.toISO({ suppressMilliseconds: false }) as string
}

/** Parse a bare calendar date "YYYY-MM-DD" into a luxon DateTime in UTC at midnight. */
export function parseCalendarDate(input: string, field: string): DateTime {
  const dt = DateTime.fromISO(input, { zone: "utc" })
  if (!dt.isValid) {
    throw ApiError.badRequest(
      "invalid_date",
      `Invalid ISO date for "${field}": ${JSON.stringify(input)} (expected YYYY-MM-DD).`,
    )
  }
  // Normalize to the start of the day so business-day arithmetic is offset-free.
  return dt.startOf("day")
}

/** Format a luxon DateTime as a bare calendar date "YYYY-MM-DD". */
export function formatCalendarDate(dt: DateTime): string {
  return dt.toISODate() as string
}
