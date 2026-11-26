# Slapdash

Design small wood-frame buildings (sheds, pool houses, decks, fences) by talking to Claude.
You describe what you want; Claude builds it out of real lumber in a 3D model you can turn,
cut and walk through floor by floor, checks it with a structural solver, and gives you the
drawings, a materials list with a cut list and prices, and build steps. It runs in the
browser, installs to an iPad or phone home screen, and is open source (MIT).

<!-- Screenshot: the pool-house sample on desktop (docs/design/ has the artboards). -->

## Quick start

```sh
corepack enable          # or install pnpm; the version is pinned in package.json
pnpm install
pnpm dev                 # http://localhost:5173
```

No key is needed for the 3D builder, drawings, materials and the sample. To talk to Claude,
copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (the dev server's `/api/claude`
reads it; it never reaches the browser).

Node ≥ 22.18. See [CONTRIBUTING.md](CONTRIBUTING.md) for tests, the packages and how to add
commands, builders and materials.

## Environment variables

Every variable is documented in [`.env.example`](.env.example). In short:

| Variable | Where | What |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | server | Claude. Without it the chat says "Claude isn't connected". |
| `SLAPDASH_MONTHLY_BUDGET_USD` | server | Monthly Claude cap (default $10). Also set the same limit in the Anthropic Console. |
| `SLAPDASH_MODEL`, `SLAPDASH_EFFORT`, `SLAPDASH_RATE_PER_*`, … | server | Model and limits. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | server | Optional Upstash Redis for spend and rate-limit counters on a deployment. |
| `SLAPDASH_DEFAULT_LOCATION` | server | Default "City, ST" for design loads. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser (build time) | Optional: sign-in and projects synced across devices. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | server | Optional: the Claude server's sign-in check (defaults to the `VITE_` values). |
| `SUPABASE_SECRET_KEY` | your machine only | `pnpm supabase:add-user`. Never `VITE_`, never needed on Vercel. |

Only `VITE_*` values reach the browser, and of the Supabase ones only the URL and the
publishable key. `pnpm check:secrets` builds the app with sentinel secrets and fails if any of
them (or their names) shows up in the bundle.

## Self-hosting without Supabase

The simplest deploy: one person or a family, projects kept in each browser.

1. Import the repo into [Vercel](https://vercel.com/new). `vercel.json` has the build, the
   `/api/claude` function and the headers; leave the framework preset as "Other".
2. Set `ANTHROPIC_API_KEY` and `SLAPDASH_MONTHLY_BUDGET_USD`, and optionally add Upstash from
   the Vercel Marketplace (otherwise counters reset on cold starts). In the Anthropic Console
   (Settings → Limits) set the same monthly spending limit: it is the hard backstop.
3. Deploy.

Projects live in the browser that made them (IndexedDB) and don't follow you to another
device; Projects → "Import a .slapdash file" opens a project file made elsewhere. To have the
same projects everywhere, add Supabase (next section).

> **A public deploy without Supabase lets anyone with the link use your Claude budget.** The
> per-IP rate limit and the monthly cap still apply, but there is no sign-in. Keep the URL to
> yourself, or add Supabase.

## Self-hosting with Supabase

Adds sign-in (password or passkey), keeps projects in your account and syncs them between your
laptop, iPad and phone, and stores photos in a private bucket. The free tier is plenty for
one person.

1. **Create a project** at [supabase.com](https://supabase.com/dashboard) (free).
2. **Create the tables.** Either `pnpm --filter @slapdash/storage exec supabase link --project-ref <ref>`
   then `pnpm --filter @slapdash/storage exec supabase db push --workdir ../..`, or paste
   [`supabase/migrations/20261125000000_projects.sql`](supabase/migrations/20261125000000_projects.sql)
   into the Dashboard's SQL editor and run it. It creates the `projects` and `project_files`
   tables with row-level security and the private `project-files` bucket.
3. **Authentication settings** (Dashboard → Authentication):
   - Sign In / Providers → turn **off** "Allow new users to sign up". There is no sign-up
     screen; you add yourself in the next step.
   - Passkeys → turn them **on**, with relying party ID = your domain (e.g.
     `slapdash.example.com`, no scheme) and allowed origin = `https://slapdash.example.com`.
   - URL Configuration → Site URL = `https://slapdash.example.com`.
4. **Add yourself.** Put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (Project Settings → API
   Keys → Secret keys) in your local `.env`, then run `pnpm supabase:add-user you@example.com`;
   it asks for a password. Or use Dashboard → Authentication → Users → Add user (tick "Auto
   confirm").
5. **Vercel env vars:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the
   publishable or anon key), and `SUPABASE_URL` for the Claude server. Then **redeploy**:
   `VITE_` values are baked in at build time. Don't add the secret key to Vercel.
6. **Sign in on each device.** After the first password sign-in the app offers to add a
   passkey (Face ID / Touch ID); after that "Sign in with a passkey" works on that device.
   Projects you made before setting up Supabase move into your account the first time you sign
   in on that device.

With Supabase on, the Claude server only answers signed-in users (`401 sign_in_required`
otherwise) and rate-limits per user. Sign out is at the bottom of the Projects window.

### When the free project pauses

Supabase pauses free projects after about a week without activity. Slapdash keeps working:
you'll see one chat note, "Can't reach the cloud right now. Your work is saved on this device
and will sync when it's back.", and everything you do is saved on the device and queued. To
wake it up, open the Dashboard and click **Restore project** (a minute or two). The next time
the app comes to the foreground or back online, the queue goes through and the chat says
"Synced." Upgrading the project to a paid plan stops the pausing.

If two devices changed the same project while apart, the last one to sync wins the project,
and the other version is kept as "<name> (conflict, this device)", so nothing is lost.

## Installing on iPad and iPhone

Open your deploy in Safari → Share → **Add to Home Screen**. It opens full-screen with the
stud-wall icon, works offline once it has loaded (the app and your last project), and keeps
its own sign-in and storage, separate from Safari's. Home-screen apps are exempt from
Safari's seven-day storage clearing, so this is the way to keep projects on an iPad. Android
Chrome offers "Install app" the same way.

## Tests

```sh
pnpm test                # every package (vitest)
pnpm typecheck
pnpm check:secrets       # no secret in the browser bundle
pnpm --filter @slapdash/web e2e   # Playwright (run `pnpm --filter @slapdash/web exec playwright install chromium` once)
pnpm test:supabase       # the storage adapter against a local Supabase (needs Docker)
```

## Further reading

- Architecture decisions: [ADR-0001 core architecture](docs/adr/0001-core-architecture.md),
  [ADR-0002 model, Claude, renderer and API](docs/adr/0002-model-claude-renderer-api.md),
  [ADR-0003 app design](docs/adr/0003-app-design.md).
- [CONTRIBUTING.md](CONTRIBUTING.md)
- Packages: [core](packages/core/README.md), [catalog](packages/catalog/README.md),
  [solver](packages/solver/README.md), [agent](packages/agent/README.md),
  [keyhole](packages/keyhole/README.md), [storage](packages/storage/README.md),
  [web app](apps/web/README.md).

## License

[MIT](LICENSE)
