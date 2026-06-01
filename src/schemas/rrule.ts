import { z } from "@hono/zod-openapi"
import { IsoDateTime, Tzid } from "./common.js"

const WindowSchema = z
  .object({
    start: IsoDateTime.openapi({ example: "2026-01-01T00:00:00" }),
    end: IsoDateTime.openapi({ example: "2026-12-31T23:59:59" }),
  })
  .openapi("RRuleWindow")

export const RRuleExpandRequestSchema = z
  .object({
    rrule: z.string().min(1).max(2000).optional().openapi({
      description:
        'A single RFC 5545 RRULE. The "RRULE:" prefix is optional. Mutually exclusive with "ruleSet".',
      example: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10",
    }),
    ruleSet: z.string().min(1).max(8000).optional().openapi({
      description:
        "A full VEVENT-style rule set: newline-joined RRULE / EXRULE / RDATE / EXDATE lines. Do NOT include a DTSTART line here — pass it via `dtstart`. Mutually exclusive with `rrule`.",
      example: "RRULE:FREQ=DAILY;COUNT=10\nEXDATE:20260103T090000",
    }),
    dtstart: IsoDateTime.openapi({
      description:
        "Recurrence anchor as local wall-clock time. Any offset is ignored; the zone comes from `tzid`.",
      example: "2026-01-01T09:00:00",
    }),
    tzid: Tzid.optional(),
    between: WindowSchema.optional().openapi({
      description:
        "Inclusive wall-clock window. Occurrences within [start, end] are returned. Mutually exclusive with `count`.",
    }),
    count: z.number().int().min(1).max(1000).optional().openapi({
      description:
        "Number of occurrences to return from `dtstart` onward. Mutually exclusive with `between`. Clamped to the server's per-call result cap (`MAX_RESULTS`).",
      example: 10,
    }),
    includeText: z
      .boolean()
      .optional()
      .openapi({ description: "Include a human-readable description of the rule.", example: true }),
  })
  // Exactly one of rrule | ruleSet.
  .refine((v) => (v.rrule === undefined) !== (v.ruleSet === undefined), {
    message: 'Provide exactly one of "rrule" or "ruleSet".',
    path: ["rrule"],
  })
  // Not both between and count (either, or neither when the rule is intrinsically bounded).
  .refine((v) => !(v.between !== undefined && v.count !== undefined), {
    message: 'Provide at most one of "between" or "count".',
    path: ["between"],
  })
  .openapi("RRuleExpandRequest")

export const RRuleExpandResponseSchema = z
  .object({
    occurrences: z.array(z.string()).openapi({
      description: "DST-correct occurrence datetimes as offset-aware ISO 8601 strings.",
      example: ["2026-01-01T09:00:00.000-05:00", "2026-01-02T09:00:00.000-05:00"],
    }),
    count: z.number().int().openapi({ example: 2 }),
    truncated: z.boolean().openapi({
      description: "True when more occurrences exist beyond the returned (capped) set.",
      example: false,
    }),
    text: z.string().optional().openapi({
      description: "Present when `includeText` was true.",
      example: "every day for 10 times",
    }),
  })
  .openapi("RRuleExpandResponse")

export type RRuleExpandRequest = z.infer<typeof RRuleExpandRequestSchema>
