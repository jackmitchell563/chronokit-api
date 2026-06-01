import { createRoute, type OpenAPIHono } from "@hono/zod-openapi"
import type { Env } from "../env.js"
import { loadConfig } from "../env.js"
import { describeCron, nextCronRuns } from "../lib/cron.js"
import { validateTimezone } from "../lib/datetime.js"
import { ErrorResponseSchema } from "../schemas/common.js"
import {
  CronNextRequestSchema,
  CronNextResponseSchema,
  CronValidateResponseSchema,
} from "../schemas/cron.js"

const route = createRoute({
  method: "post",
  path: "/v1/cron/next",
  tags: ["Cron"],
  summary: "Validate a cron expression and list its next run times",
  description:
    "POST a cron expression (5-field, 6-field with seconds, or a macro like @daily). Returns validity, an optional plain-English description, and the next N run times in the requested timezone. A syntactically invalid expression returns 200 with `{ valid: false, error }` so it doubles as a validator; structural request errors return 400.",
  request: {
    body: {
      content: { "application/json": { schema: CronNextRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          // The response is either the success shape or the validate-failure shape.
          schema: CronNextResponseSchema.or(CronValidateResponseSchema),
        },
      },
      description: "Next runs computed, OR the expression was malformed (`valid:false`).",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Structural request error (bad body, bad types, or unknown timezone).",
    },
  },
})

export function registerCronRoute(app: OpenAPIHono<{ Bindings: Env }>): void {
  app.openapi(route, (c) => {
    const body = c.req.valid("json")
    const config = loadConfig(c.env)
    const tzid = validateTimezone(body.tzid ?? "UTC")

    // Validate the expression first so a malformed cron is a clean 200/valid:false,
    // not a 400 — supporting the "is this cron valid?" use case.
    const check = describeCron(body.expression)
    if (!check.valid) {
      return c.json(
        { valid: false as const, error: check.error ?? "Invalid cron expression." },
        200,
      )
    }

    const result = nextCronRuns({
      expression: body.expression,
      tzid,
      count: body.count,
      maxResults: config.maxResults,
      ...(body.includeDescription !== undefined
        ? { includeDescription: body.includeDescription }
        : {}),
    })
    return c.json(result, 200)
  })
}
