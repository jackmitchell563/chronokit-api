import { createRoute, type OpenAPIHono } from "@hono/zod-openapi"
import type { Env } from "../env.js"
import { type BusinessDayInput, computeBusinessDays } from "../lib/business-days.js"
import { BusinessDaysRequestSchema, BusinessDaysResponseSchema } from "../schemas/business-days.js"
import { ErrorResponseSchema } from "../schemas/common.js"

const route = createRoute({
  method: "post",
  path: "/v1/business-days/calc",
  tags: ["Business Days"],
  summary: "Add/subtract working days or count working days between two dates",
  description:
    'Mode "add": return the date N working days from `start` (±N). Mode "diff": count the working days between `start` and `end`. A working day is any day not in the weekend mask (ISO weekdays, default Sat+Sun) and not in the caller-supplied `holidays` list. No holiday data is bundled — the caller owns it.',
  request: {
    body: {
      content: { "application/json": { schema: BusinessDaysRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: BusinessDaysResponseSchema } },
      description: "Computation succeeded.",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Validation error (bad date, invalid weekend mask, missing mode field).",
    },
  },
})

export function registerBusinessDaysRoute(app: OpenAPIHono<{ Bindings: Env }>): void {
  app.openapi(route, (c) => {
    const body = c.req.valid("json")

    // The zod refinements already guarantee the mode-specific field is present;
    // narrow to the discriminated input the compute layer expects.
    const input: BusinessDayInput =
      body.mode === "add"
        ? {
            mode: "add",
            start: body.start,
            days: body.days as number,
            weekend: body.weekend,
            holidays: body.holidays,
          }
        : {
            mode: "diff",
            start: body.start,
            end: body.end as string,
            weekend: body.weekend,
            holidays: body.holidays,
          }

    const result = computeBusinessDays(input)
    return c.json(result, 200)
  })
}
