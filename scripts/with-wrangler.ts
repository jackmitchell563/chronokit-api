/**
 * Boot a local `wrangler dev` server, wait until it answers `/health`, run a callback
 * against its base URL, then tear it down. Shared by the demo (`seed.ts`) and the
 * OpenAPI dump so neither imports the Worker's bundle directly — avoiding CJS/ESM interop
 * quirks (some deps ship dual builds that only resolve cleanly under esbuild/Vite, which
 * is exactly what wrangler uses to serve the Worker).
 */

import { type ChildProcess, spawn } from "node:child_process"

export interface WranglerOptions {
  host?: string
  port?: number
  readyTimeoutMs?: number
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) return
      lastErr = new Error(`health responded ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`Worker did not become healthy within ${timeoutMs}ms: ${String(lastErr)}`)
}

/** Run `fn(baseUrl)` against a freshly-booted wrangler dev server; always tears down. */
export async function withWrangler<T>(
  fn: (baseUrl: string) => Promise<T>,
  opts: WranglerOptions = {},
): Promise<T> {
  const host = opts.host ?? "127.0.0.1"
  const port = opts.port ?? Number(process.env.PORT ?? 8788)
  const readyTimeoutMs = opts.readyTimeoutMs ?? 45_000
  const baseUrl = `http://${host}:${port}`

  const child: ChildProcess = spawn(
    "npx",
    // enforce=false: the demo/dump exercise compute, not the RapidAPI proxy gate.
    // Overriding here keeps them working without the gitignored .dev.vars (prod stays
    // enforce=true via wrangler.toml).
    [
      "wrangler",
      "dev",
      "--ip",
      host,
      "--port",
      String(port),
      "--local",
      "--var",
      "ENFORCE_RAPIDAPI_PROXY:false",
    ],
    { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env } },
  )

  let settled = false
  const cleanup = () => {
    if (!settled && !child.killed) {
      settled = true
      child.kill("SIGTERM")
    }
  }
  process.on("exit", cleanup)
  const onSigint = () => {
    cleanup()
    process.exit(130)
  }
  process.on("SIGINT", onSigint)

  try {
    await waitForHealth(baseUrl, readyTimeoutMs)
    return await fn(baseUrl)
  } finally {
    cleanup()
    process.off("SIGINT", onSigint)
    // Allow the port to be released before the caller exits.
    await new Promise((r) => setTimeout(r, 500))
  }
}
