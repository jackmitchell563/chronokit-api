/**
 * Worker environment bindings and parsed runtime configuration.
 *
 * The Worker is stateless and has no storage bindings. Configuration arrives as
 * plain-text `vars` (see wrangler.toml) plus one optional secret. Everything is
 * parsed and clamped here so the rest of the code works with typed, validated config.
 */

export interface Env {
  /** When "true", incoming requests must carry a valid RapidAPI proxy secret. */
  ENFORCE_RAPIDAPI_PROXY?: string
  /** Shared secret RapidAPI injects as the `X-RapidAPI-Proxy-Secret` header. */
  RAPIDAPI_PROXY_SECRET?: string
  /** Hard upper bound on results returned per call (defensive clamp). */
  MAX_RESULTS?: string
}

/** Absolute ceiling the Worker will never exceed, even if MAX_RESULTS is misconfigured. */
export const HARD_MAX_RESULTS = 1000

/** Fallback when MAX_RESULTS is unset/invalid — matches the Free tier cap. */
const DEFAULT_MAX_RESULTS = 50

export interface RuntimeConfig {
  enforceProxy: boolean
  proxySecret: string | undefined
  /** Effective per-call result cap after clamping to [1, HARD_MAX_RESULTS]. */
  maxResults: number
}

function parseMaxResults(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_RESULTS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_RESULTS
  return Math.min(n, HARD_MAX_RESULTS)
}

/** Derive validated runtime config from raw Worker env. Never throws. */
export function loadConfig(env: Env): RuntimeConfig {
  return {
    enforceProxy: env.ENFORCE_RAPIDAPI_PROXY === "true",
    proxySecret: env.RAPIDAPI_PROXY_SECRET,
    maxResults: parseMaxResults(env.MAX_RESULTS),
  }
}
