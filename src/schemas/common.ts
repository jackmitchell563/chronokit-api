/**
 * Shared zod schemas + OpenAPI fragments used across routes.
 *
 * `z` here is the zod instance re-exported by `@hono/zod-openapi` (zod v4 with the
 * `.openapi()` metadata extension), so every schema doubles as OpenAPI documentation.
 */

import { z } from "@hono/zod-openapi"

/** ISO 8601 datetime (offset optional) or bare date. Validated precisely downstream. */
export const IsoDateTime = z.string().min(1).max(64).openapi({
  description: "ISO 8601 datetime (offset optional) or a bare calendar date.",
  example: "2026-03-08T09:00:00",
})

/** Bare calendar date YYYY-MM-DD (offset-free). */
export const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a calendar date in YYYY-MM-DD form.")
  .openapi({ description: "Calendar date, YYYY-MM-DD.", example: "2026-03-09" })

/** IANA timezone identifier. Membership is validated at runtime via luxon. */
export const Tzid = z.string().min(1).max(64).openapi({
  description: "IANA timezone identifier. Defaults to UTC when omitted.",
  example: "America/New_York",
})

/** ISO weekday integer, 1=Mon … 7=Sun. */
export const IsoWeekday = z
  .number()
  .int()
  .min(1)
  .max(7)
  .openapi({ description: "ISO weekday: 1=Mon … 7=Sun.", example: 6 })

/** The standard structured error envelope returned for every non-2xx response. */
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "validation_error" }),
      message: z.string().openapi({ example: "Request body failed validation." }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse")

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
