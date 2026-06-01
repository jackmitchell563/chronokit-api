import { z } from "@hono/zod-openapi"
import { Tzid } from "./common.js"

export const CronNextRequestSchema = z
  .object({
    expression: z.string().min(1).max(200).openapi({
      description:
        "A cron expression: standard 5-field, 6-field with seconds, or a macro (@daily, @weekly, @hourly, …).",
      example: "0 9 * * 1-5",
    }),
    tzid: Tzid.optional(),
    count: z.number().int().min(1).max(1000).default(5).openapi({
      description:
        "Number of upcoming run times to return. Clamped to the server's per-call result cap (`MAX_RESULTS`).",
      example: 5,
    }),
    includeDescription: z.boolean().optional().openapi({
      description: "Include a plain-English description of the schedule.",
      example: true,
    }),
  })
  .openapi("CronNextRequest")

export const CronNextResponseSchema = z
  .object({
    valid: z
      .literal(true)
      .openapi({ description: "Always true on success; invalid input returns a 400." }),
    description: z.string().optional().openapi({
      description: "Present when `includeDescription` was true.",
      example: "At 09:00 AM, Monday through Friday",
    }),
    nextRuns: z.array(z.string()).openapi({
      description: "Upcoming run times as offset-aware ISO 8601 strings in `tzid`.",
      example: ["2026-03-06T09:00:00.000-05:00", "2026-03-09T09:00:00.000-04:00"],
    }),
    count: z.number().int().openapi({ example: 2 }),
  })
  .openapi("CronNextResponse")

/** Lightweight validation-only response for a malformed expression (200 with valid:false). */
export const CronValidateResponseSchema = z
  .object({
    valid: z.literal(false),
    error: z.string().openapi({ example: "Invalid cron expression." }),
  })
  .openapi("CronValidateResponse")

export type CronNextRequest = z.infer<typeof CronNextRequestSchema>
