import { z } from "@hono/zod-openapi"
import { CalendarDate, IsoWeekday } from "./common.js"

const WeekendSchema = z
  .array(IsoWeekday)
  .max(6)
  .default([6, 7])
  .openapi({
    description:
      "Weekend mask as ISO weekdays (1=Mon … 7=Sun). Default [6,7]=Sat+Sun. Gulf: [5,6]=Fri+Sat.",
    example: [6, 7],
  })

const HolidaysSchema = z
  .array(CalendarDate)
  .max(2000)
  .default([])
  .openapi({
    description:
      "Caller-supplied holiday dates (YYYY-MM-DD) to exclude. The caller owns this data.",
    example: ["2026-01-01", "2026-12-25"],
  })

export const BusinessDaysRequestSchema = z
  .object({
    start: CalendarDate.openapi({ description: "Start calendar date.", example: "2026-03-06" }),
    mode: z.enum(["add", "diff"]).openapi({
      description: '"add" → date N working days away; "diff" → count working days to `end`.',
      example: "add",
    }),
    days: z.number().int().optional().openapi({
      description: 'Working-day offset for mode "add" (±N). Required when mode="add".',
      example: 5,
    }),
    end: CalendarDate.optional().openapi({
      description: 'End calendar date for mode "diff". Required when mode="diff".',
      example: "2026-03-20",
    }),
    weekend: WeekendSchema,
    holidays: HolidaysSchema,
  })
  // Enforce the mode-specific required field.
  .refine((v) => (v.mode === "add" ? v.days !== undefined : true), {
    message: '"days" is required when mode is "add".',
    path: ["days"],
  })
  .refine((v) => (v.mode === "diff" ? v.end !== undefined : true), {
    message: '"end" is required when mode is "diff".',
    path: ["end"],
  })
  .openapi("BusinessDaysRequest")

export const BusinessDaysResponseSchema = z
  .object({
    mode: z.enum(["add", "diff"]),
    result: z
      .string()
      .optional()
      .openapi({ description: 'Resulting date (mode "add"), YYYY-MM-DD.', example: "2026-03-13" }),
    workingDays: z.number().int().optional().openapi({
      description: 'Working-day count (mode "diff"). Signed if end precedes start.',
      example: 10,
    }),
    weekend: z
      .array(IsoWeekday)
      .openapi({ description: "Echo of the effective weekend mask.", example: [6, 7] }),
  })
  .openapi("BusinessDaysResponse")

export type BusinessDaysRequest = z.infer<typeof BusinessDaysRequestSchema>
