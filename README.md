# ChronoKit API — Recurrence & Scheduling Toolkit

> Send an RRULE, a cron expression, or date math and get back the exact occurrences — DST-correct, timezone-aware, human-readable — without standing up a calendar platform.

ChronoKit turns the famously painful "recurring events" problem into three simple, **stateless** HTTP calls. No OAuth, no calendar library to own, no RFC 5545 edge cases to learn.

**▶ Available on RapidAPI:** https://rapidapi.com/johnevanmitchell/api/chronokit

| Endpoint | What it does |
| --- | --- |
| `POST /v1/rrule/expand` | Expand an RFC 5545 **RRULE** (or a full rule set with `EXDATE`/`RDATE`) into exact occurrence datetimes — DST-correct in any IANA timezone, with optional human-readable text. |
| `POST /v1/cron/next` | Validate a **cron** expression (5/6-field or `@daily`-style macros), describe it in plain English, and list the next N run times in a timezone. |
| `POST /v1/business-days/calc` | **Business-day** math: add/subtract ±N working days, or count working days between two dates, with a custom weekend mask and caller-supplied holidays. |

**Stack:** [Hono](https://hono.dev) on Cloudflare Workers · TypeScript (strict) · zod-validated boundaries · `rrule` + `luxon` + `cron-parser` + `cronstrue`. Stateless, no database — runs on the Workers free tier.

---

## Use it via RapidAPI

Subscribe on RapidAPI (free Basic tier available), then call it with your RapidAPI key. RapidAPI shows the exact host and ready-made code snippets for every language on the listing.

```bash
curl -X POST 'https://<your-host>.p.rapidapi.com/v1/rrule/expand' \
  -H 'content-type: application/json' \
  -H 'X-RapidAPI-Key: YOUR_RAPIDAPI_KEY' \
  -H 'X-RapidAPI-Host: <your-host>.p.rapidapi.com' \
  -d '{"rrule":"FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5","dtstart":"2026-03-02T09:00:00","tzid":"America/New_York","includeText":true}'
```

### More examples

```jsonc
// POST /v1/cron/next — next 3 runs + a plain-English description
{"expression":"0 9 * * 1-5","tzid":"America/New_York","count":3,"includeDescription":true}

// POST /v1/business-days/calc — add 5 working days, skipping a holiday
{"start":"2026-03-06","mode":"add","days":5,"weekend":[6,7],"holidays":["2026-03-09"]}
```

---

## Why DST correctness is the whole point

Recurring-event math is deceptively hard — almost entirely because of timezones and DST. `rrule` computes recurrences in a "floating" frame (wall-clock times with no real timezone). ChronoKit:

1. Parses your `dtstart` and window as **naive wall-clock** (any offset you send is discarded — RRULE semantics are defined on local wall time).
2. Expands in that floating frame.
3. **Re-anchors** every result into your `tzid` via `luxon`, picking the correct UTC offset for that specific date.

So "every day at 09:00 in America/New_York" across the spring-forward boundary stays **09:00 local** while the emitted offset flips `-05:00 → -04:00`. The cron endpoint applies the same principle via `cron-parser`'s timezone engine. See `src/lib/datetime.ts` for the rationale and `tests/unit/rrule.test.ts` for the DST corpus.

Everything ChronoKit returns is **pure deterministic computation from your input** — no third-party data is fetched, stored, or resold. The business-day endpoint takes holidays as an input array, so you own that data.

---

## Run it yourself

```bash
pnpm install

# Full demo end-to-end (boots wrangler dev, hits all 3 endpoints, tears down)
pnpm seed

# Or run the dev server + explore the Swagger UI at /docs
pnpm dev          # → http://127.0.0.1:8787
```

```bash
# Local curl (no RapidAPI key needed in dev)
curl -s http://127.0.0.1:8787/v1/rrule/expand \
  -H 'content-type: application/json' \
  -d '{"rrule":"FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=5","dtstart":"2026-03-02T09:00:00","tzid":"America/New_York","includeText":true}'
```

### Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run the Worker locally via `wrangler dev`. |
| `pnpm build` | `wrangler deploy --dry-run` — validates the production bundle. |
| `pnpm typecheck` | `tsc --noEmit` (strict). |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix. |
| `pnpm test` | Vitest unit + integration suite (88 tests). |
| `pnpm test:e2e` | E2E smoke tests over real HTTP against `wrangler dev`. |
| `pnpm seed` | One-command demo tour. |
| `pnpm openapi:dump [file]` | Print/write the OpenAPI spec. |

### Self-hosting

It's a standard Cloudflare Worker: `pnpm run deploy` (after `npx wrangler login`). Stateless, no bindings, no database — `$0/mo` on the Workers free tier. Set `ENFORCE_RAPIDAPI_PROXY=true` + a `RAPIDAPI_PROXY_SECRET` if you front it with RapidAPI; leave enforcement off for direct/self-hosted use.

---

## Project layout

```
src/
  index.ts              Worker entry (module worker)
  app.ts                Hono app: CORS, error handler, proxy guard, routes, OpenAPI, Swagger
  env.ts                Env bindings + parsed/clamped runtime config
  errors.ts             Structured ApiError + JSON error envelope
  middleware/
    proxy-secret.ts     RapidAPI proxy-secret verification (constant-time)
  lib/
    datetime.ts         luxon plumbing: tz validation, wall-clock ↔ floating, DST re-anchor
    rrule.ts            RFC 5545 expansion (DST-correct, bounded, EXDATE/RDATE)
    cron.ts             cron next-runs + human-readable description
    business-days.ts    working-day add/diff (custom weekend + caller holidays)
  routes/               one file per endpoint (createRoute + handler)
  schemas/              zod request/response schemas (also generate the OpenAPI doc)
tests/
  unit/ integration/ e2e/
```

## License

[MIT](./LICENSE).
