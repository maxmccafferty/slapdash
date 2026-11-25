# @slapdash/keyhole

The Claude server (ADR-0001 §2, ADR-0002 §A6, §D9). **Server only**: it holds the
Anthropic API key. `apps/web/src` must never import it (`apps/web/test/no-server-imports.test.ts`).

It is a Web `Request → Response` handler:

- `GET /api/claude` → `{ configured, model, budget }`.
- `POST /api/claude` with `{ messages }` → checks the method, the `Origin`, the key, the body
  size, the body schema, the monthly budget and the per-user rate limit, in that order. It
  then streams `budget`, every Anthropic stream event as `anthropic`, and `done` (or `error`).

The request to Claude is fixed on the server (`src/claude.ts`): the configured model
(`claude-sonnet-5-5` by default), `max_tokens`, `output_config.effort`, the system prompt
with `cache_control`, the tools, top-level automatic caching, and the refusal fallback
(`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) unless it is turned
off. `thinking` is left out, so the model thinks adaptively.

## Entry points

| Import | What |
| --- | --- |
| `@slapdash/keyhole` | `createKeyhole({ config, store, transport?, now?, identify? })`, `createKeyholeFromEnv(env)`, `readConfig`, the usage stores, pricing, budget and rate-limit helpers. |
| `@slapdash/keyhole/node` | `toNodeMiddleware(handler \| { load })` for Connect/Vite; used by the dev server. |
| `src/vercel-entry.ts` | The Vercel function, bundled to `dist/vercel.js` by `pnpm build:api` and re-exported by `api/claude.js`. |

## Modules

- `config.ts`: environment variables, defaults and validation. The key is redacted from
  `JSON.stringify` and `util.inspect`.
- `pricing.ts`: $/MTok per model (checked against the pricing page; see `PRICES_CHECKED`) and
  `costMicroUsd()`. Unknown models are priced at the most expensive row.
- `budget.ts`: `ok` below 80%, `warning` from 80%, `capped` at 100%; UTC months.
- `usage-store.ts` and `stores/`: memory, JSON file (local dev) and Upstash Redis over REST
  (deployed). `selectUsageStore()` picks one from the environment.
- `rate-limit.ts`: fixed per-minute and per-day windows per user.
- `identify.ts`: the user is a SHA-256 hash of the client IP until sign-in exists.
- `handler.ts`: the handler, spend tracking from stream usage, and upstream error mapping.

## Without Upstash on a deployment

Counters live in memory and reset on every cold start, so the budget there is a soft guide.
Add Upstash (free tier, Vercel Marketplace) or rely on the spending limit set in the
Anthropic Console, which should always match `SLAPDASH_MONTHLY_BUDGET_USD`.

```sh
pnpm --filter @slapdash/keyhole test
pnpm --filter @slapdash/keyhole typecheck
```
