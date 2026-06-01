import { createRoute, type OpenAPIHono } from "@hono/zod-openapi"
import type { Env } from "../env.js"
import { loadConfig } from "../env.js"
import { parseWallClock, validateTimezone, type WallClock } from "../lib/datetime.js"
import { type ExpandInput, expandRecurrence } from "../lib/rrule.js"
import { ErrorResponseSchema } from "../schemas/common.js"
import { RRuleExpandRequestSchema, RRuleExpandResponseSchema } from "../schemas/rrule.js"

const route = createRoute({
  method: "post",
  path: "/v1/rrule/expand",
  tags: ["RRULE"],
  summary: "Expand an RFC 5545 recurrence rule into DST-correct occurrences",
  description:
    "POST an RRULE (or a full rule set with EXDATE/RDATE), a DTSTART, an optional IANA timezone, and either a `between` window or a `count`. Returns the exact occurrence datetimes — DST-correct and timezone-aware — with an optional human-readable description.",
  request: {
    body: {
      content: { "application/json": { schema: RRuleExpandRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RRuleExpandResponseSchema } },
      description: "Occurrences computed successfully.",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Validation error, malformed rule, or an unbounded rule with no window/count.",
    },
  },
})

export function registerRRuleRoute(app: OpenAPIHono<{ Bindings: Env }>): void {
  app.openapi(route, (c) => {
    const body = c.req.valid("json")
    const config = loadConfig(c.env)

    const tzid = validateTimezone(body.tzid ?? "UTC")
    const dtstart = parseWallClock(body.dtstart, "dtstart")

    let between: { start: WallClock; end: WallClock } | undefined
    if (body.between) {
      between = {
        start: parseWallClock(body.between.start, "between.start"),
        end: parseWallClock(body.between.end, "between.end"),
      }
    }

    const input: ExpandInput = {
      dtstart,
      tzid,
      maxResults: config.maxResults,
    }
    if (body.rrule !== undefined) input.rrule = body.rrule
    if (body.ruleSet !== undefined) input.ruleSet = body.ruleSet
    if (between !== undefined) input.between = between
    if (body.count !== undefined) input.count = body.count
    if (body.includeText !== undefined) input.includeText = body.includeText

    const result = expandRecurrence(input)
    return c.json(result, 200)
  })
}
