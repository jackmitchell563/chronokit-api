/**
 * RFC 5545 recurrence expansion, DST-correct.
 *
 * Accepts either a single RRULE line or a full VEVENT-style rule set (RRULE + optional
 * EXRULE / EXDATE / RDATE). DTSTART and the optional IANA `tzid` are supplied separately
 * so the result is unambiguous. See {@link ../lib/datetime.ts} for the floating-frame
 * + re-anchor strategy that keeps wall-clock stable across DST boundaries.
 *
 * Safety: callers must bound the expansion (either a `between` window or an explicit
 * `count`). A rule with no UNTIL/COUNT and no window is rejected as `unbounded_rule`
 * before any expansion runs, so a single request can never spin the CPU unbounded.
 */

import { type RRule, type RRuleSet, rrulestr } from "rrule"
import { ApiError } from "../errors.js"
import { floatingDateFromWallClock, type WallClock, zonedFromFloating } from "./datetime.js"

export interface ExpandInput {
  /** A single RRULE line, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10". Mutually exclusive with ruleSet. */
  rrule?: string
  /**
   * A full rule set: newline-joined RRULE/EXRULE/RDATE/EXDATE lines (no DTSTART line —
   * pass that via `dtstart`). Mutually exclusive with `rrule`.
   */
  ruleSet?: string
  /** Naive wall-clock DTSTART (already parsed from the request). */
  dtstart: WallClock
  /** IANA zone the wall-clock times live in (already validated). */
  tzid: string
  /** Inclusive window in naive wall-clock; results within [start, end] are returned. */
  between?: { start: WallClock; end: WallClock }
  /** Cap on the number of occurrences (used when `between` is absent). */
  count?: number
  /** Effective hard cap from runtime config; never exceeded. */
  maxResults: number
  /** Include a human-readable description of the rule. */
  includeText?: boolean
}

export interface ExpandResult {
  occurrences: string[]
  count: number
  /** True when more occurrences exist beyond the returned/clamped set. */
  truncated: boolean
  text?: string
}

/**
 * Reject the `rrrulestr` DTSTART line if a caller smuggles one into `ruleSet`; we own
 * DTSTART via the dedicated field to keep the floating-frame contract intact.
 */
function assertNoEmbeddedDtstart(ruleSet: string): void {
  if (/^\s*DTSTART/im.test(ruleSet)) {
    throw ApiError.badRequest(
      "validation_error",
      'Do not include a DTSTART line in "ruleSet"; supply it via the "dtstart" field instead.',
    )
  }
}

/** A single RRULE has a finite horizon iff it declares COUNT or UNTIL. */
function ruleIsBounded(rruleLine: string): boolean {
  return /\bCOUNT=/i.test(rruleLine) || /\bUNTIL=/i.test(rruleLine)
}

/** A rule set is finite iff every RRULE/EXRULE line is bounded (RDATE/EXDATE are finite by nature). */
function ruleSetIsBounded(ruleSet: string): boolean {
  const ruleLines = ruleSet
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^R?RULE[:;]/i.test(l) || /^EXRULE[:;]/i.test(l))
  if (ruleLines.length === 0) return true // only RDATE/EXDATE → finite
  return ruleLines.every(ruleIsBounded)
}

/**
 * A parsed rule, tagged by kind. `RRuleSet extends RRule`, so `instanceof` cannot
 * distinguish them — we carry an explicit discriminator instead.
 */
type BuiltRule = { kind: "single"; rule: RRule } | { kind: "set"; rule: RRuleSet }

/**
 * Build an rrule object/set from the input, anchored at the floating DTSTART.
 * Throws `invalid_rrule` with the underlying parser message on malformed input.
 */
function buildRule(input: ExpandInput): BuiltRule {
  const dtstart = floatingDateFromWallClock(input.dtstart)

  if (input.rrule !== undefined) {
    try {
      // `rrulestr` accepts a lone "FREQ=..." or a "RRULE:FREQ=..." line; a single RRULE
      // always yields an RRule (never a set).
      const parsed = rrulestr(input.rrule, { dtstart }) as RRule
      return { kind: "single", rule: parsed }
    } catch (err) {
      throw ApiError.badRequest("invalid_rrule", `Could not parse RRULE: ${messageOf(err)}`)
    }
  }

  // Rule-set path.
  const ruleSet = input.ruleSet as string
  assertNoEmbeddedDtstart(ruleSet)
  // Prepend a synthetic DTSTART so EXDATE/RDATE resolve against the same anchor.
  const dtstartLine = `DTSTART:${toICalLocal(input.dtstart)}`
  const text = `${dtstartLine}\n${ruleSet}`
  try {
    const set = rrulestr(text, { dtstart, forceset: true }) as RRuleSet
    return { kind: "set", rule: set }
  } catch (err) {
    throw ApiError.badRequest("invalid_rrule", `Could not parse rule set: ${messageOf(err)}`)
  }
}

/** Render naive wall-clock as an iCal "floating" local timestamp (no Z). */
function toICalLocal(wc: WallClock): string {
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${wc.year}${p2(wc.month)}${p2(wc.day)}T${p2(wc.hour)}${p2(wc.minute)}${p2(wc.second)}`
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Expand a recurrence rule into concrete, DST-correct ISO 8601 occurrences.
 */
export function expandRecurrence(input: ExpandInput): ExpandResult {
  const hasWindow = input.between !== undefined
  const hasCount = input.count !== undefined

  // Determine the source rule text for boundedness analysis.
  const ruleText = input.rrule ?? input.ruleSet ?? ""
  const bounded = input.rrule !== undefined ? ruleIsBounded(ruleText) : ruleSetIsBounded(ruleText)

  // A rule with no intrinsic horizon AND no window/count would expand forever.
  if (!bounded && !hasWindow && !hasCount) {
    throw ApiError.badRequest(
      "unbounded_rule",
      'This rule has no COUNT/UNTIL. Provide a "between" window or a "count" to bound the expansion.',
    )
  }

  const built = buildRule(input)
  const rule = built.rule

  // The effective cap: min of the requested count and the runtime hard cap.
  // When only a window is given, we still clamp to maxResults to bound output size.
  const cap = hasCount ? Math.min(input.count as number, input.maxResults) : input.maxResults

  let floating: Date[]
  if (hasWindow) {
    const start = floatingDateFromWallClock(
      (input.between as NonNullable<ExpandInput["between"]>).start,
    )
    const end = floatingDateFromWallClock(
      (input.between as NonNullable<ExpandInput["between"]>).end,
    )
    if (end.getTime() < start.getTime()) {
      throw ApiError.badRequest(
        "validation_error",
        '"between.end" must be on or after "between.start".',
      )
    }
    // Fetch one extra to detect truncation without unbounded work.
    floating = betweenWithCap(rule, start, end, cap + 1)
  } else {
    // Count-only: ask for cap+1 to detect "there were more".
    floating = rule.all((_, i) => i < cap + 1)
  }

  const truncated = floating.length > cap
  const kept = truncated ? floating.slice(0, cap) : floating

  const occurrences = kept.map((d) => zonedFromFloating(d, input.tzid))

  const result: ExpandResult = {
    occurrences,
    count: occurrences.length,
    truncated,
  }
  if (input.includeText) result.text = describeRule(built)
  return result
}

/**
 * Bound the work of `between` by halting the iterator once `limit` results are collected.
 * Both RRule and RRuleSet expose the iterator-callback form: returning false halts.
 */
function betweenWithCap(rule: RRule | RRuleSet, start: Date, end: Date, limit: number): Date[] {
  const out: Date[] = []
  rule.between(start, end, true, (date, i) => {
    out.push(date)
    return i < limit - 1
  })
  return out
}

/** Human-readable description via rrule's built-in toText (English). */
function describeRule(built: BuiltRule): string {
  if (built.kind === "single") {
    try {
      return built.rule.toText()
    } catch {
      return built.rule.toString()
    }
  }
  // For a set, describe the primary RRULE if present; fall back to the serialized set.
  const primary = built.rule.rrules()[0]
  if (primary) {
    try {
      return primary.toText()
    } catch {
      return primary.toString()
    }
  }
  return "Custom recurrence (explicit dates only)."
}
