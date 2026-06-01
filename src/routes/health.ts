import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi"
import type { Env } from "../env.js"

const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.string().openapi({ example: "chronokit-api" }),
    version: z.string().openapi({ example: "1.0.0" }),
    time: z
      .string()
      .openapi({ description: "Server time (UTC ISO 8601).", example: "2026-05-31T12:00:00.000Z" }),
  })
  .openapi("HealthResponse")

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["Meta"],
  summary: "Liveness probe",
  description: "Returns service status and version. Unauthenticated and never enforced.",
  responses: {
    200: {
      content: { "application/json": { schema: HealthResponseSchema } },
      description: "Service is healthy.",
    },
  },
})

export const SERVICE_VERSION = "1.0.0"

export function registerHealthRoute(app: OpenAPIHono<{ Bindings: Env }>): void {
  app.openapi(route, (c) =>
    c.json(
      {
        status: "ok" as const,
        service: "chronokit-api",
        version: SERVICE_VERSION,
        time: new Date().toISOString(),
      },
      200,
    ),
  )
}
