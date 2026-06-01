/**
 * Cron expression tools: validity, a plain-English description, and the next N run times
 * in a given IANA timezone.
 *
 * Uses `cron-parser` (v5) for next-run computation — it is timezone- and DST-aware, so
 * "every weekday at 09:00" in America/New_York yields 14:00Z before spring-forward and
 * 13:00Z after, automatically. `cronstrue` provides the human-readable text.
 *
 * Supported syntax: standard 5-field (`m h dom mon dow`), 6-field with seconds
 * (`s m h dom mon dow`), and macros (`@daily`, `@weekly`, `@hourly`, etc.).
 */

import { CronExpressionParser } from "cron-parser"
import cronstrue from "cronstrue"
import { DateTime } from "luxon"
import { ApiError } from "../errors.js"

export interface CronInput {
  expression: string
  /** IANA zone for run-time computation (already validated). Defaults to UTC upstream. */
  tzid: string
  /** Number of upcoming runs to return. */
  count: number
  /** Optional reference instant; defaults to now. Mainly for deterministic tests. */
  from?: Date
  maxResults: number
  includeDescription?: boolean
}

export interface CronResult {
  valid: true
  description?: string
  nextRuns: string[]
  count: number
}

/**
 * Validate a cron expression and return whether it parses, plus (optionally) a
 * human-readable description — WITHOUT computing runs. Used by the route to report
 * `valid: false` cleanly instead of throwing, when the caller only wants validation.
 *
 * Validity is the conjunction of BOTH engines: `cronstrue` (syntax/describability) and
 * `cron-parser` (schedulability). The two disagree on semantically-impossible-but-
 * syntactically-valid expressions like `0 0 30 2 *` (Feb 30): cronstrue happily describes
 * it, but cron-parser throws because no such instant exists. Probing both here keeps the
 * documented validator contract consistent — "impossible" crons report `valid:false`
 * rather than surfacing as a 400 only once the route tries to iterate runs.
 */
export function describeCron(expression: string): {
  valid: boolean
  description?: string
  error?: string
} {
  // cronstrue throws on invalid input; treat that as "not valid" with the reason.
  let description: string
  try {
    description = cronstrue.toString(expression, { throwExceptionOnParseError: true })
  } catch (err) {
    return { valid: false, error: messageOf(err) }
  }
  // Even if cronstrue can describe it, confirm cron-parser can actually schedule it —
  // this rejects impossible-date expressions (e.g. Feb 30) that cronstrue accepts.
  try {
    CronExpressionParser.parse(expression)
  } catch (err) {
    return { valid: false, error: messageOf(err) }
  }
  return { valid: true, description }
}

/**
 * Compute the next N runs of a cron expression in `tzid`. Throws `invalid_cron` if the
 * expression cannot be parsed. Result count is clamped to `maxResults`.
 */
export function nextCronRuns(input: CronInput): CronResult {
  const cap = Math.min(input.count, input.maxResults)

  let iterator: ReturnType<typeof CronExpressionParser.parse>
  try {
    iterator = CronExpressionParser.parse(input.expression, {
      tz: input.tzid,
      currentDate: input.from ?? new Date(),
    })
  } catch (err) {
    throw ApiError.badRequest("invalid_cron", `Invalid cron expression: ${messageOf(err)}`)
  }

  const nextRuns: string[] = []
  for (let i = 0; i < cap; i++) {
    let next: ReturnType<typeof iterator.next>
    try {
      next = iterator.next()
    } catch {
      // Some expressions (with explicit UNTIL-like upper bounds via ranges) can exhaust;
      // stop gracefully rather than erroring on a partially-fulfilled request.
      break
    }
    // cron-parser yields an absolute instant; re-render in the target zone so the
    // offset is human-meaningful (e.g. 09:00-05:00, flipping to -04:00 across DST).
    nextRuns.push(DateTime.fromJSDate(next.toDate()).setZone(input.tzid).toISO() as string)
  }

  const result: CronResult = {
    valid: true,
    nextRuns,
    count: nextRuns.length,
  }
  if (input.includeDescription) {
    const d = describeCron(input.expression)
    if (d.description) result.description = d.description
  }
  return result
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // cronstrue prefixes parse failures with "Error: "; strip it for a cleaner message.
  return raw.replace(/^Error:\s*/, "")
}
