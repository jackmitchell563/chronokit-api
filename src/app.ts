/**
 * ChronoKit API — application wiring.
 *
 * Builds the OpenAPIHono app: CORS, a structured global error handler, the RapidAPI
 * proxy-secret guard on `/v1/*`, the three compute routes, plus `/health`,
 * `/openapi.json`, and Swagger UI at `/docs`. Exported as a factory so tests can
 * construct a fresh, isolated instance.
 */

import { swaggerUI } from "@hono/swagger-ui"
import type { Hook } from "@hono/zod-openapi"
import { OpenAPIHono } from "@hono/zod-openapi"
import { cors } from "hono/cors"
import type { Env } from "./env.js"
import { ApiError } from "./errors.js"
import { proxySecretMiddleware } from "./middleware/proxy-secret.js"
import { registerBusinessDaysRoute } from "./routes/business-days.js"
import { registerCronRoute } from "./routes/cron.js"
import { registerHealthRoute, SERVICE_VERSION } from "./routes/health.js"
import { registerRRuleRoute } from "./routes/rrule.js"

/**
 * Turn a failed zod request validation into our structured 400 instead of Hono's
 * default. Applied to every `app.openapi()` route via the constructor's defaultHook.
 * The Hono env generic is the full `{ Bindings: Env }` object, not the bindings alone.
 */
const validationHook: Hook<unknown, { Bindings: Env }, "", unknown> = (result, c) => {
  if (!result.success) {
    const err = ApiError.badRequest(
      "validation_error",
      "Request failed validation.",
      result.error.issues,
    )
    return c.json(err.toBody(), 400)
  }
  return undefined
}

export function createApp(): OpenAPIHono<{ Bindings: Env }> {
  const app = new OpenAPIHono<{ Bindings: Env }>({ defaultHook: validationHook })

  // --- Cross-cutting middleware ---
  // Permissive CORS: this is a public, key-gated utility API with no cookies/sessions,
  // so any origin may call it (RapidAPI proxies server-side anyway).
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], maxAge: 86_400 }))

  // RapidAPI proxy-secret guard applies only to billable compute endpoints.
  app.use("/v1/*", proxySecretMiddleware)

  // --- Global error handler: every thrown error becomes structured JSON ---
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toBody(), err.status as 400 | 401 | 404 | 500)
    }
    // Unknown/unexpected error: do not leak internals.
    const fallback = new ApiError(500, "internal_error", "An unexpected error occurred.")
    return c.json(fallback.toBody(), 500)
  })

  app.notFound((c) =>
    c.json(
      new ApiError(
        404,
        "not_found",
        `No route for ${c.req.method} ${new URL(c.req.url).pathname}.`,
      ).toBody(),
      404,
    ),
  )

  // --- Routes ---
  registerHealthRoute(app)
  registerRRuleRoute(app)
  registerCronRoute(app)
  registerBusinessDaysRoute(app)

  // --- OpenAPI document + Swagger UI ---
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "ChronoKit API",
      version: SERVICE_VERSION,
      description:
        "DST-correct recurrence (RRULE), cron, and business-day computation as stateless HTTP. No accounts, no calendar platform — send a rule, get the dates.",
      // No contact URL is set: the public repo/listing URL is environment-specific and
      // is filled in at publish time (see DEPLOY.md). Shipping a real `name` avoids
      // baking a placeholder `your-org/...` link into the imported RapidAPI spec.
      contact: { name: "ChronoKit API" },
      license: { name: "MIT" },
    },
    servers: [{ url: "/", description: "Current host" }],
    tags: [
      { name: "RRULE", description: "RFC 5545 recurrence expansion." },
      { name: "Cron", description: "Cron parsing, description, and next-run computation." },
      { name: "Business Days", description: "Working-day arithmetic with custom weekend masks." },
      { name: "Meta", description: "Service metadata." },
    ],
  })

  // The RapidAPI proxy-secret is supplied by the gateway, not the end user, so it is
  // documented but not modeled as an OpenAPI security scheme (which would prompt for it
  // in Swagger). Swagger UI here exercises the public dev deployment.
  app.get("/docs", swaggerUI({ url: "/openapi.json" }))

  // Friendly root redirect to the docs.
  app.get("/", (c) => c.redirect("/docs"))

  return app
}
