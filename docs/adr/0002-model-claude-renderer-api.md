# ADR-0002: Model ↔ Claude ↔ renderer API, and v1 product decisions

**Status:** Proposed
**Date:** 2026-11-24
**Builds on:** ADR-0001

## Context

ADR-0001 set the architecture: a parts-and-joints model as the source of truth, Claude editing it through tools, a WebGL renderer, two physics engines and a modular backend. This ADR decides how Claude changes the model, how the renderer follows, how Claude sees what it built, and the product decisions the design needs. Questions not yet decided are listed at the end and are left open on purpose.

## Decision

### A. The API layer

1. **The model is the only meeting point.** Claude and the renderer never talk to each other. Claude changes the model; the renderer draws whatever the model says.
2. **One command bus is the only writer.** Every change is a typed command (add, move, resize, connect, delete, and the builders below), validated against a schema, applied, and recorded with its inverse. Everything one Claude turn does is one undo group.
3. **Claude's tools are generated from the command schemas**, so the tool definitions and the validation can never drift apart.
4. **Two levels of tools.** Primitives (add part, connect, move, delete) and builders that encode US light-frame carpentry: `build_wall`, `frame_floor`, `pour_slab`, `build_roof`, `add_opening`, `build_fence`, `place_structure`, and more. Claude decides what to build; deterministic code lays out every stud, header, joist and fastener.
5. **Claude reads through queries, not dumps.** Each turn carries a compact project summary (assemblies, key dimensions, IDs); `find_parts`, `get_part`, `measure` and `list_materials` fetch detail on demand. The system prompt and tool list are prompt-cached.
6. **The browser runs the agent loop; the server is a stateless keyhole.** The server function holds the API key, the system prompt, the tool list and the model choice, enforces rate limits and the budget (D9), and streams. Tool calls run in the browser against the model (where the solver and physics also run), and results go back to Claude through the server. The server stores nothing about the project.
7. **Refusals are information.** A command that fails validation (impossible span, clash, unknown material) returns a plain-language error as the tool result, and Claude adjusts. Each turn has caps on tool calls and snapshots.
8. **Claude can use history.** Tools: `undo`, `redo`, `list_history`, `save_version`, `list_versions`, `restore_version`. A restore is itself undoable. The user can do the same by asking.
9. **Units.** Millimetres internally; feet and inches on screen and in speech; tools accept strings like `"16ft 6in"`, parsed in code, so Claude never does unit arithmetic.

### B. Vision: letting Claude see

10. **A `snapshot` tool, called when Claude chooses.** Parameters: angle (`top`, `front`, `back`, `left`, `right`, `iso`, or frame-a-part), mode (`textured`, `blueprint`, `xray`, `stress`, `exploded`), highlighted parts, optional ID labels, optional dimension lines, and size. The default is a four-view sheet (top, front, side, 3D) in one image. It renders from an offscreen camera, so the user's view never moves. About 768px by default; Claude can ask for a larger, zoomed render.
11. **When to look**, per the system prompt: spatially tricky work (roof intersections, openings lining up, stairs, angles, attaching to other structures); before reporting a large build done; after a refused command or a failed check; and whenever the user asks it to look.
12. **The user can send images.** A "look at this" button sends the current view and anything the user has pointed at. Uploaded photos (an existing wall, a sketch) are stored through `ProjectStore` and attached to the conversation.
13. **Images age out.** After a turn or two, a snapshot in the history is replaced by a one-line text stub, so context does not grow with every look.
14. **Images are for noticing, numbers are for measuring.** Exact checks go through `measure` and the model, never through reading an image.

### C. The renderer

15. **React Three Fiber subscribes to the model store** with per-part selectors, so only changed parts re-render. Repeated members are instanced per material and section. The renderer has no dependency on Claude and can be built and tested without it. Parts Claude adds animate into place, so the user watches it build.
16. **The 3D view is view-only.** Orbit, pan, zoom, preset angles and the view modes (textured, blueprint, x-ray, stress, exploded). There is no direct editing: every change is made by talking or typing to Claude. The command bus keeps direct editing possible later.

### D. Product decisions for v1

1. **Scope: the full ADR-0001 feature set, delivered in internal phases.**
   - *P1 Foundation* — model, catalog schema, command bus with undo, local `ProjectStore`, renderer basics, builder tools for a shell.
   - *P2 Claude* — server keyhole, agent loop in the browser, voice and typing, `snapshot`, history tools, per-project memory.
   - *P3 Materials* — catalog tier 1 with textures, materials and cut lists, the built-in price table, PDF export.
   - *P4 Physics* — stability sim, structural solver, stress view, location-based loads.
   - *P5 Hosting* — Supabase adapter, Vercel deploy, budget enforcement, secret scanning.
   - *P6 Breadth* — catalog tiers 2 and 3, exploded view and assembly sequence polish.
2. **Site: blank flat ground.** The project starts as an open space to play in. The user adds other structures (an existing house, a pool, trees, a fence line) as simple objects when he wants them. There is no property or satellite import.
3. **Location and design loads.** A default location comes from an environment variable (`SLAPDASH_DEFAULT_LOCATION`), with a per-project override. Ground snow load, wind speed and frost depth are looked up from a bundled table keyed by US location, and each value is shown with its source and is editable. The real location lives in `.env`, never in the repo.
4. **Exports: PDF** with the materials list, cut list, a simple plan and elevations.
5. **Conventions: US light-frame (platform framing, nominal imperial lumber) only.** Other traditions can arrive later as builder plug-ins.
6. **Input: voice and typing on every device.** On a phone the layout is the model plus the input bar; nothing else competes for the screen.
7. **History: undo plus named saves**, both available to Claude through its tools (A8).
8. **Memory: each project's chat is persisted** through `ProjectStore`, with older turns summarized so cost stays flat.
9. **Budget: $10 a month.** Set as the spending limit in the Anthropic Console, and also tracked by the server, which warns at 80% and stops with a clear message at the cap.
10. **Testing: scripted evals.** A suite of prompts ("16×20 pool house on a slab, 9ft walls, sliding door on the south side") runs through the real agent loop, and assertions check the resulting model: part counts, dimensions, openings, valid joints and no clashes. The solver has its own tests against textbook cases and published span tables.

### E. Stack and engine decisions

1. **Framework: Vite + React + TypeScript**, a single-page app. Vercel functions in `api/` carry the Claude proxy and budget tracking. No server rendering: the app is one 3D canvas that runs in the browser.
2. **Repo: a small pnpm monorepo.** `packages/core` (model, catalog schema, command bus, builders, units — pure TypeScript), `packages/catalog` (data), `packages/solver` (runs in a Web Worker or Node), `packages/agent` (tool definitions, system prompt, loop, snapshots — shared by the app and the evals), `apps/web` (Vite app, scene, input, `ProjectStore` adapters), `api/` (Vercel functions), `evals/`. `pnpm install && pnpm dev` runs it. No build orchestrator until one is needed.
3. **Claude model: Sonnet 5.5 (`claude-sonnet-5-5`) by default**, set by config (`SLAPDASH_MODEL`). Builders do the carpentry, so the model mostly interprets intent and picks tools; revisit with eval data.
4. **Voice: the browser's Web Speech API** for recognition and spoken replies, behind a small `VoiceProvider` interface so another provider can plug in.
5. **Joints in the solver: pinned or fixed per joint type, plus a capacity check.**
   - *Pinned:* nailed and screwed framing, joist hangers, hurricane ties, posts on post bases.
   - *Fixed:* welded steel, posts embedded in concrete, members continuous over a support.
   - *Capacity:* every joint checks its forces (shear, withdrawal) against its rating, so an undersized hanger or a toenailed rafter goes red even when the lumber is fine.
   - No semi-rigid joints: there is no honest data for them.
   - Sheathed walls and diagonal bracing are modelled as equivalent diagonal braces, so racking under wind is captured and "this wall needs sheathing or a brace" is a real result. The stability sim uses the same pinned/fixed flags.
6. **The solver is written in-house**: a 3D direct-stiffness frame solver with a sparse or banded solve, in a Web Worker. Existing open-source solvers (e.g. Stabileo, AGPL-3.0) are used only as an outside cross-check of results, never copied, so the license choice stays free.
7. **Free building blocks** (confirm each license when adopted): Three.js, React Three Fiber, drei and postprocessing; Rapier with `@react-three/rapier`; `three-mesh-bvh` (picking, clash detection) and `three-bvh-csg` (cutting openings in sheet goods); Zustand with Immer patches (undo); Zod 4 `toJSONSchema` (tool schemas); Dexie or idb (IndexedDB); suncalc (sun position); pdf-lib or jsPDF (PDF export); Poly Haven and ambientCG (CC0 textures and HDRIs); a simple first-fit-decreasing cut-list optimizer in-house, with a WASM bin-packing library if it ever needs more. Reference data for tests and the loads table: the AWC span calculator and the ASCE Hazard Tool, both free on the web.

### F. Experience and project hygiene

1. **Claude confirms big changes, not small ones.** *(Amended 2026-11-27: now opt-in and off by default; see the amendment at the end.)* Small edits apply at once, since undo covers them. Large ones — a new structure, a roof, or roughly 50 or more parts — get a one-line plan and a go-ahead first ("I'll build a 16×20 shell with a gable roof — go?"). Saying "just do it" turns the check off for that project.
2. **Sign-in: password or passkey, with a long-lived session** (Supabase adapter). Magic links are not the main route: on an iPad they tend to open in a different browser than the home-screen app.
3. **Installable as a PWA** — manifest, icons, full-screen launch from the home screen, and an offline app shell.
4. **A "something's off" report.** A button, and a `report_problem` tool Claude can call, save the project, the recent conversation and a snapshot through `ProjectStore` — to the owner's Supabase on the hosted copy, or as a downloadable file in local mode — so a problem can be replayed exactly.
5. **Devices:** tested on the owner's own phone, iPad and laptop; no formal minimum.
6. **Docs and contributor basics:** a README (what it is, screenshots, quick start, environment variables, self-hosting with and without Supabase), CONTRIBUTING (including how to add a material and how to add a builder), architecture docs and ADRs under `docs/`, a LICENSE, and CI on every push (lint, type check, unit tests).
7. **Data model conventions — defaults for the design to confirm:** y-up, millimetres, origin at a fixed corner of the ground; parts grouped into named assemblies ("south wall", "roof"); stable, readable part IDs (e.g. `W2-S07`) that Claude and snapshot labels share; a single ground level to start, with storeys possible later.

## Considered options

- **The server runs the agent loop** — not chosen now: the model, solver and physics live in the browser. Revisit if Claude ever needs to work while the app is closed.
- **Claude writes the whole scene as JSON each turn** — rejected: expensive, fragile, and loses undo and validation.
- **An image on every turn** — rejected: costly, and usually unnecessary; Claude asks when it needs one.
- **Direct manipulation editing in v1** — left out by choice; the command bus keeps it possible.
- **Importing the property (parcel data, satellite tracing)** — rejected for v1 in favour of an open space to play in.
- **Hard-coding the user's location** — rejected: an environment variable keeps it out of a public repo.
- **Metric or non-US framing from the start** — deferred: one tradition first keeps the builders correct.

## Consequences

- The command bus and its schemas are the spine: tools, validation, undo, history and evals all come from them, so they are designed and tested first.
- Builder tools carry most of the carpentry knowledge and most of the reliability; each needs unit tests against real framing rules.
- The browser is the runtime for the agent loop, solver and physics, so heavy work (solver, snapshots) runs in a Web Worker or offscreen so the UI never stalls.
- With view-only 3D, the quality of the conversation is the product: the system prompt, tool descriptions and evals deserve as much care as the renderer.
- The location table needs a credible data source and a "values are estimates — confirm with your building department" note.
- A $10 cap is tight if snapshots and large builds are frequent; the evals should measure cost per typical turn so the cap can be checked against reality.
- Uploaded photos are untrusted input: Claude treats them as information, never as instructions, and the per-turn caps bound what a confused turn can do.
- Evals that call the real API cost money; they run on demand and before releases, not on every commit.

## Open questions for the design

Deliberately not decided yet:

- **Open-source license** — MIT keeps it easiest to play with; note that building on any AGPL code would force AGPL.
- **Interactivity** — how pointing and selecting work in a view-only 3D view (e.g. tapping a part to say "that one"); worked out in the design.
- **Eval mechanics** — real API calls versus recorded responses, and how often each runs.

## Amendment (2026-11-27): §F1 is opt-in

The big-change confirmation in §F1 is now **off by default**. Claude builds what the person asks straight away, big or small, and says what it chose when it had to fill a gap.

Why: in use, the plan and "Build it" step was friction more than protection. People asked for a shell and got a question back, then had to tap again before anything appeared. A turn is already a single undo step, so Undo takes back a whole build in one tap. That is the safety net §F1 was standing in for, and it costs the person nothing until they need it.

The check still exists for people who want it. Asking to see plans first makes Claude call `set_preferences` with `confirmBigChanges: true`. From then on the loop's guard refuses big changes without an approved plan, Claude shows `propose_plan` and the app shows the plan card with Build it / Change something, exactly as §F1 described. Saying "just do it" turns it off again. The setting is saved with the project's chat log. Logs saved earlier with no preference now read as off.
