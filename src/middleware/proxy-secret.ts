/**
 * RapidAPI proxy-secret verification.
 *
 * RapidAPI injects a fixed header (`X-RapidAPI-Proxy-Secret`) on every request it
 * forwards to your origin. Verifying it ensures callers cannot bypass RapidAPI's
 * metering/billing by hitting the Worker URL directly.
 *
 * Enforcement is opt-in via the `ENFORCE_RAPIDAPI_PROXY` var so local `wrangler dev`
 * and the demo run without a secret. In production you set the secret AND flip the
 * flag to "true" (see DEPLOY.md). When enforced but no secret is configured, we fail
 * CLOSED (401) rather than silently allowing traffic.
 */

import type { Context, Next } from "hono"
import type { Env } from "../env.js"
import { loadConfig } from "../env.js"
import { ApiError } from "../errors.js"

export const PROXY_SECRET_HEADER = "X-RapidAPI-Proxy-Secret"

/**
 * Constant-time string comparison. Avoids leaking secret length/content via early-exit
 * timing. Returns false immediately only on length mismatch (length is not secret here).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function proxySecretMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<void> {
  const config = loadConfig(c.env)
  if (!config.enforceProxy) {
    await next()
    return
  }

  // Enforcement on but no secret configured → misconfiguration; fail closed.
  if (!config.proxySecret) {
    throw ApiError.unauthorized(
      "Server misconfiguration: proxy enforcement enabled but no secret set.",
    )
  }

  const provided = c.req.header(PROXY_SECRET_HEADER)
  if (!provided || !timingSafeEqual(provided, config.proxySecret)) {
    throw ApiError.unauthorized()
  }

  await next()
}
