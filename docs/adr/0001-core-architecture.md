# ADR-0001: Slapdash core architecture

**Status:** Proposed
**Date:** 2026-11-24

## Context

Slapdash is a voice-driven, AI-assisted 3D building planner, made first for one non-technical user who wants to plan real projects around his property — a pool house first, then renovations. He talks to Claude, and Claude builds and edits a to-scale 3D model he can look around, pull apart and stress-test. It must work on a laptop, iPad and phone, look good, produce a materials list with rough costs, and be safe to publish as open source — and easy for other people to clone and play with.

## Decision

1. **Platform: a web app, hosted on Vercel.** React + Three.js (React Three Fiber) frontend; a serverless function on Vercel is the only thing that talks to Claude. One link works on every device, with nothing to install.

2. **Claude access: an Anthropic API key held server-side — not "Sign in with Claude".** Anthropic does not allow third-party apps to offer claude.ai login or to run on Pro/Max subscription limits without prior approval, so subscription login is out. The key lives only in the server environment (`ANTHROPIC_API_KEY`), never in the repo or the browser. The user logs into Slapdash itself (see 10); a Console spending limit plus a per-user rate limit cap cost and abuse.

3. **Model: a graph of parts and joints, which Claude edits through tools.** The source of truth is a JSON model of *parts* (material, section, dimensions, position) connected by *joints* (type, fasteners, rating). Claude never draws anything; it calls a small tool set (add/move/resize part, connect with joint, measure, list materials, run checks), and the renderer, physics and solver all read the same model. This gives undo, saved projects, materials lists and exploded views from one data structure.

4. **Materials and joints are first-class, with real properties — and the catalog is data, not code.** Every material, product and joint type is an entry in a data file (see Appendix A), carrying strength, stiffness, density, thermal (R-value) where relevant, unit price range, texture set, and which joints it accepts. Joints — nailed, screwed, bolted, joist hanger, hurricane tie, notched, mortise and tenon, welded; glued, threaded, crimped and sweated pipe fittings — carry load ratings, so a joint can be the failure point. Adding a material means adding a data entry and a texture, not touching the engine.

5. **Two physics engines, for two different questions.**
   - *Will it tip over?* — Rapier (WASM) rigid-body sim, run on demand ("drop it under gravity"), not continuously.
   - *Is it overstressed?* — a linear frame solver (direct stiffness method) treating parts as beam elements and joints as connections, under dead, live, snow and wind loads. Results draw as a green → yellow → red utilization overlay on parts and joints, and Claude can explain a failure and suggest a fix.

6. **Rendering: WebGL2 with PBR materials; WebGPU deferred.** CC0 textures and HDRIs (Poly Haven, ambientCG) mapped at real-world scale, grain along each board, per-board variation, soft shadows, ambient occlusion and a sun set to the real location and time of day. Glass gets proper transparency and reflection. Instancing for repeated members, KTX2-compressed textures, LOD, and an adaptive quality tier keep it smooth on an iPad. View modes: good-looking, blueprint/wireframe, and stress. Textures ship in the repo as static assets.

7. **Exploded and assembly views come from the joint graph.** Parts separate along their connections, with a slider; a Claude-made build order steps through foundation → framing → sheathing → roof as a personal instruction manual.

8. **Voice first.** Push-to-talk with browser speech recognition (Whisper as a fallback) and spoken replies.

9. **Secrets hygiene is part of the repo from the first commit.** `.env*` is gitignored with a committed `.env.example`; GitHub secret scanning and push protection are on; a gitleaks pre-commit hook catches mistakes locally; self-hosters bring their own key, documented in the README.

10. **Backend: modular, behind a storage-and-auth interface; Supabase is one optional adapter.**
    - The app talks only to a small interface (`ProjectStore`: list / load / save / delete projects, upload files; `Auth`: current user, sign in, sign out). Nothing outside the adapters imports Supabase.
    - *Default adapter: local-only.* Projects in IndexedDB, no login, no backend. `git clone`, `npm install`, `npm run dev` and it runs — the only thing needed to talk to Claude is an API key, and even the 3D builder works without one.
    - *Supabase adapter (the hosted copy).* Switched on purely by setting the Supabase environment variables. Supabase Auth (password or passkey, ADR-0002 §F2), Postgres for projects with row-level security, Storage for uploads such as yard photos. The app keeps working copies on the device and syncs them through a `SyncedProjectStore` (local first, the remote as the source of truth across devices; see `packages/storage/README.md`). Free tier. The service-role key stays server-side only, like the Anthropic key. The repo includes the SQL schema/migrations so anyone can stand up their own in minutes.
    - Local autosave sits under any adapter, so a bad connection never loses work, and projects export and import as a single versioned `.slapdash` file — for backups, sharing with a contractor, and moving between adapters.
    - Other backends (PocketBase, Firebase, a plain file server) are just another adapter.

11. **Pricing: one built-in price table, plus the user's own prices.** A dated table in the repo gives a low–high unit price for each catalog entry, researched once when it is built and updated by hand when it drifts. A price the user gives ("my yard has 2x6s at $7.80") overrides it for that project. Every cost shows as a range with the table's date, never a single number. There is no live price lookup.

12. **Site context and code-awareness flags.** A project sits on a site: ground and terrain, the existing house, pool, trees, property lines and setbacks, plus location for sun and snow/wind loads. Catalog entries can carry flags Claude raises in plain language — safety glass near water, GFCI outlets near the pool, pool-barrier fence rules, setbacks — as reminders, not code compliance.

## Considered options

- **Claude.ai / subscription sign-in** — rejected: against Anthropic's terms for third-party apps without approval, and it risks the user's account.
- **User pastes their own API key** — kept only as an optional mode for self-hosters trying it out; too fiddly for the primary user.
- **Native app (iOS / desktop)** — rejected: three platforms to ship, and an app store in the way; the web covers all of them.
- **Run locally on the user's computer** — rejected: no single link, and the key would sit on the machine.
- **Claude generates geometry or code directly** — rejected in favour of a typed tool API on a data model: more reliable, validatable, undoable.
- **Rapier alone for "stress"** — rejected: rigid-body physics shows collapse and tipping, not member stress or joint capacity.
- **WebGPU from the start** — deferred: WebGL2 is plenty for a pool-house-sized model, and Three.js can move to WebGPU later with a WebGL fallback.
- **Commercial or licensed textures** — rejected: CC0 assets ship cleanly in an open-source repo.
- **Supabase wired directly through the app** — rejected: makes the repo hard to just clone and run; an adapter keeps it optional.
- **Vercel Postgres + Blob + Auth.js** — not chosen for the hosted copy (three pieces versus one), but possible as another adapter.
- **Browser-only storage as the only store** — rejected for the hosted copy: no sync across devices; kept as the default adapter and the autosave layer.
- **Materials hard-coded in the engine** — rejected: a data-driven catalog lets anyone add materials without touching the engine.
- **Scraping retailer sites for prices** — rejected: against their terms and brittle; there is no public Home Depot or Lowe's price API.
- **Live price check through Claude's web search** — dropped: more cost and moving parts than one user needs; the table is updated if prices drift.
- **Retail price API (SerpApi Home Depot)** — rejected: paid beyond a small free allowance, and not needed.

## Consequences

- The parts-and-joints data model and the catalog schema are the foundation and are built first; the renderer, Claude tools, solver, exploded view, storage format and materials list all depend on them, and changing them later is expensive. The `.slapdash` format and the catalog both need a version field from the start.
- The storage/auth interface must stay small and stable, and both adapters need tests against the same suite so they stay interchangeable.
- The catalog is big; it ships in tiers (Appendix A) and grows by data contributions. Not every catalog entry needs structural properties — finishes and fixtures only need geometry, texture and price.
- The structural solver is real engineering code: it needs tests against textbook cases and published span tables before anyone trusts its colours.
- Every stress result, cost and code flag is labelled as a planning estimate, not an engineering stamp, a quote or a code check; anything needing a permit still goes to an engineer or inspector. The app can export a summary for that conversation.
- Running cost is the API bill on one key — expected to be a few dollars a month for one person, bounded by the Console spending limit — plus Supabase and Vercel on free tiers.
- Supabase's free tier has storage caps and pauses projects after a stretch of inactivity; local autosave covers it, and the README should say how to wake or upgrade it.
- The hosted instance must stay behind login; being open source means the code is public, not the keys.
- The built-in price table goes stale and needs a refresh routine; regional pricing is later work.
- A non-technical user may over-trust the model — the UI has to make "estimate" impossible to miss.

## Planned work

1. Parts-and-joints data model, catalog schema, versioned `.slapdash` format, and the storage/auth interface with the local-only adapter
2. 3D scene, textures, lighting and view modes
3. Claude tool API and server function
4. Voice input and spoken replies
5. Catalog tier 1 (pool-house shell) with textures, properties and prices
6. Exploded view and assembly sequence
7. Stability sim (Rapier)
8. Structural solver and stress overlay
9. Materials list, price table and overrides
10. Supabase adapter (auth, projects table with RLS, storage, migrations), cloud sync, rate limiting, Vercel deploy, and secret-scanning setup
11. Site context: terrain, existing structures, setbacks, location-based loads and sun
12. Catalog tiers 2 and 3

## Appendix A — Catalog

**Tier 1 — enough to build a pool-house shell**
- *Lumber:* dimensional (SPF, Douglas fir, Southern yellow pine), pressure-treated, cedar and redwood
- *Engineered wood:* LVL, glulam beams, I-joists
- *Sheet goods:* plywood, OSB
- *Concrete and masonry:* poured footings and slabs, piers/sonotubes, concrete block (CMU), rebar, gravel base
- *Fasteners and hardware:* nails, structural and deck screws, bolts, lags, concrete anchors, joist hangers, hurricane ties, post bases
- *Roofing:* asphalt shingles, corrugated metal, standing-seam metal, underlayment, drip edge, gutters and downspouts
- *Envelope:* house wrap, flashing, siding (lap, board-and-batten, fiber cement), trim, soffit and fascia
- *Insulation:* fiberglass batts, mineral wool, rigid foam
- *Openings:* windows (single/double-hung, casement, sliding, awning, fixed/picture), doors (entry, French, sliding glass), safety glass

**Tier 2 — finishing it inside and out**
- *Interior:* drywall, cement board for wet areas, paint and stain
- *Tile:* ceramic, porcelain, natural stone
- *Flooring:* hardwood, luxury vinyl plank, sealed or polished concrete, epoxy
- *Plumbing:* PVC, CPVC, PEX, copper, ABS, cast iron, galvanized; fittings, valves, traps and vents; fixtures (toilet, sink, outdoor shower), water heater
- *Electrical (materials list only, no simulation):* PVC and EMT conduit, wire by gauge, boxes, GFCI outlets, lights, subpanel
- *Stone and brick:* brick, stone veneer, flagstone, pavers, retaining wall block
- *More openings:* bay windows, bifold and barn doors, roll-up/garage doors, skylights
- *More roofing:* clear polycarbonate panels (pergolas), clay/concrete tile, EPDM/TPO membrane

**Tier 3 — the yard and extras**
- *Fences and gates:* wood picket and privacy, chain link, wrought iron/aluminum, glass pool fence, gate hardware
- *Decking and railings:* wood and composite decking, cable and glass railings, stairs
- *Outdoor structures:* pergolas, shade sails, sheds, outdoor kitchen pieces, pool equipment pad, pool coping
- *Steel:* steel studs, square tube, angle, I-beams
- *Insulation and HVAC extras:* spray foam, vapor barrier, mini-split, vents and fans
- *Sealants:* caulk, construction adhesive, waterproofing membrane
- *Site:* terrain and grading, trees, existing house and pool, drainage (French drains), landscape fabric, property lines
