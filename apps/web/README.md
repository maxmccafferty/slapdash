# @slapdash/web

The Slapdash web app (Vite + React + TypeScript, ADR-0002 §E1–E2). It is the **app shell** (the
frame around the model and the chat, built from the design handoff `docs/design/HANDOFF.md`,
ADR-0003) and the **3D renderer** that draws the model inside it.

```sh
pnpm dev                                   # from the repo root; or:
pnpm --filter @slapdash/web dev            # Vite dev server
pnpm --filter @slapdash/web test           # unit tests (vitest, jsdom)
pnpm --filter @slapdash/web typecheck
pnpm --filter @slapdash/web build
pnpm --filter @slapdash/web tokens         # regenerate src/styles/tokens.{css,ts}
pnpm --filter @slapdash/web check:secrets  # build with a sentinel API key and scan dist for it
pnpm --filter @slapdash/web exec playwright install chromium   # once
pnpm --filter @slapdash/web e2e            # Playwright: layout, 44px targets, 14px text, focus, axe, reduced motion, the 3D view, the 2D sheet
```

E2E is not part of `pnpm -r test`, so the workspace tests stay headless. It saves screenshots
of each state to `test-results/screens/` for comparison with the handoff artboards (Braun,
Mobile, MobileViews, MobileFloors, MobileChat).

`vite dev` also serves the Claude keyhole at `/api/claude` (the `slapdash:keyhole` plugin in
`vite.config.ts`, dev only). It reads the server environment from the repo-root `.env`; only
`VITE_*` variables ever reach the browser. App code must not import `@slapdash/keyhole` or the
Anthropic SDK (`test/no-server-imports.test.ts`). See CONTRIBUTING, "Claude server (keyhole)".

## What the shell is (and isn't)

- **Desktop (≥ 900px):** logo and the Save/Load, Undo/Redo, Materials/Steps units top left;
  project name and four ruled specs; the Floors slider top right; the four view controls
  bottom left; the zoom readout bottom right; the chat panel on the right (408px, fluid down to
  320px between 900px and about 1200px).
- **Phone (< 900px):** project name and specs top left; one vertical unit of icon-only keys
  (Project popover with Save/Load/Undo/Redo, Materials, Build steps, Floors popover) top right;
  the eye key (view controls popover) bottom left; the orange chat key bottom right, which opens
  the chat as a bottom sheet while the model slides up. No logo.
- **Not here yet:** real spec values (Footprint, Walls and Roof are placeholders; Parts is
  real), Undo/Redo keys, a naming dialog for Save, `.slapdash` download, and deleting or
  renaming projects.

UI state (view controls, floor, latched panel, phone popovers and sheet) lives in a Zustand
store, `src/state/shell-store.ts`. It never holds project data; the project lives in
`src/state/model-store.ts` (below).

## The `ShellActions` seam

Save, Load, Undo and Redo call `ShellActions` (`src/shell/actions.ts`), which `App` takes as a
prop and defaults to no-ops (component tests). `main.tsx` wires them: Save saves the open
project now and says so in the chat; Load opens the Projects modal. Undo and Redo are still
no-ops.

## Projects and first run (`src/projects/`, ADR-0003 §I)

Projects are kept in this browser's IndexedDB through `@slapdash/storage`'s local adapter.
`projects-controller.ts` (framework-free) owns the open `ProjectSession`: autosave, its bus
attached to the model store (`attach` in `src/model/bootstrap.ts`), and the Projects modal's
actions. React reads `projects-store.ts` and calls the actions through `ProjectsContext`
(inert by default, so component tests need no IndexedDB).

- **Start.** The device's last project reopens; a fresh install starts on an unsaved
  "New project" (nothing is stored until the first change). `?sample=pool-house` instead
  builds the sample from commands as a new, named project (dev and e2e).
- **First run.** On an empty site the chat shows "What are we building?", three starter keys
  (tapping one sends it) and **Open the sample pool house** (`src/shell/chat/Starters.tsx`).
  Without an API key the no-key card offers the sample instead and the field and Talk are off.
- **The sample** is a shipped file, `src/samples/pool-house.slapdash`, loaded lazily (its own
  chunk) and imported like any file, so each open is a new "Pool house". It is generated from
  `SAMPLE_SHELL_COMMANDS`: run `pnpm --filter @slapdash/web sample` after changing builders or
  the sample; `test/projects/sample.test.ts` fails when it is out of date.
- **Projects modal (Load).** A New project card, the stored projects newest first (card
  picture, name, "Edited Nov 25 · 209 parts"; the open one has the orange dot), and **Import a
  .slapdash file**. Errors show in its status line. Like Materials it covers the model only.
- **Switching** captures the old project's card picture (a 256 px iso snapshot stored as the
  project file `thumbnail`), closes its session (saving anything pending), then attaches the
  new bus. Opening the modal refreshes the open project's picture, waiting for the 3D view if
  the page has just loaded. Without WebGL cards show the dot floor.
- **Chat.** After each Claude turn the chat log is saved with the project; opening a project
  restores its transcript (what was asked and Claude's replies; Undo keys, plans and photos
  are not restored) and Claude sees the earlier turns.
- Saves also run on `pagehide` and when the tab is hidden. A failed save shows as a chat note.

## Build steps (`src/steps/`, ADR-0003 §E)

The Steps key (phone: Build steps) plays the build one step at a time. Steps come from
`buildStepGroups` in core (the pool house: Slab, Walls, Roof; openings go with the walls).
While it is open the model shows only the steps up to the current one; site context always
shows, Floors and Look from still apply, and the camera doesn't move. The filter is
`VisibilityOptions.steps` in `src/renderer/visibility.ts`, used by the 3D view, the 2D sheet
and the stress view (Claude's snapshots are unaffected). The step lives in the shell store
(`stepIndex`), resets to the first step when Steps opens or another project opens, and is
clamped when parts are removed. The panel shows "Step 2 of 3", the title, a short how-to
(`how-to.ts`), a count line, the list of steps (desktop) and Back / Next step. Desktop: a
panel in the model's bottom-right corner; phone: a compact bottom sheet under the chat key.
The scene's label ends "Showing build step 2 of 3: Walls." for screen readers.

## Chat (`src/agent/`, `src/shell/chat/`)

The chat runs Claude turns in the browser through `@slapdash/agent` (`runTurn`), against the
bus the model store follows.

- **Store and controller.** `src/state/chat-store.ts` holds what the chat shows: connection,
  budget, transcript items (`src/agent/chat-types.ts`), the running turn, the draft and
  pending photos. `src/agent/chat-controller.ts` is framework-free and the only writer: it
  owns the `AgentMemory` (one per bus; a new bus restores that project's saved chat through `chatLogFor`, or starts a new one) and the turn's
  `AbortController`, maps agent events and keyhole errors into the store, outlines new parts
  with `markInProgress` and draws a plan's footprint with `setProposal`. State lives outside
  React because the phone's `BottomSheet` unmounts the panel when it closes. `main.tsx` builds
  the controller and passes it down with `ChatProvider`; tests inject one with a scripted
  client (`@slapdash/agent/testing`).
- **How each state is reached.** `start()` reads `GET /api/claude`: `configured: false` is
  the no-key state, `budget.state: 'capped'` is the capped state, `'warning'` adds the 80% note
  once. No answer (a static preview) counts as ready. While sending, a 402 switches to capped
  and a 503 to no key; a rate limit, an upstream failure or a network error adds a note.
  `propose_plan`, `request_photo` and `offer_options` give a plan card, a photo request and
  option keys under that turn's message. A turn that changed something gets an Undo key, usable
  while its step is the newest one. Tapping a part puts it in a chip above the field; it is sent
  as `pointedAt`.
- **Photos only when asked** (ADR-0003 §J.4). Take photo and Choose photo exist only under a
  pending photo request. Photos are downscaled to 1568px JPEG and kept in memory
  (`src/agent/photos.ts`) until project storage is wired in.
- **The modal rule.** Modals (Materials, Steps, Projects) cover the model only. On desktop they
  mount inside `<main>`, and the chat is a grid sibling. On the phone they go inside `.main`
  below the chat sheet's z-index. Nothing may make the chat or the app root `inert` or
  `aria-hidden`. `test/chat/chat.test.tsx` checks this with each panel open.
- **Persistence.** `onChatChanged(memory.toChatLog())` runs after every turn and saves the log
  with the open project (`session.replaceChat`). `AgentMemory.transcript()` rebuilds the
  transcript when a project opens.
- **Voice** (ADR-0001 §8, ADR-0002 §E4). Speech goes through the `VoiceProvider` interface in
  `src/voice/voice-provider.ts`; `src/voice/web-speech.ts` implements it with the browser's
  `SpeechRecognition` and `speechSynthesis`, so another provider can slot in later. Holding Talk
  calls `controller.startTalking()`: the field gives way to a waveform and "Listening", and a
  live bubble shows confirmed words in ink and unconfirmed ones in grey. Letting go sends what
  was heard through `send(text, { spoken: true })`, with the pointed-part chip and photos like a
  typed message; nothing heard adds "Didn't catch that…" and leaves the draft alone. Only a
  spoken message gets a spoken reply: each finished assistant message and a plan's text are
  queued, after `speechText()` (`src/voice/speech-text.ts`) turns `9′ 0″` into "9 feet" and
  `16×20` into "16 by 20". Speech stops on Stop (the Send key reads Stop while Claude speaks),
  holding Talk again, sending anything, opening another project and the page being hidden.
  Talk is disabled while a turn runs.
  - **Support.** Talk is hidden unless the page is a secure context with `SpeechRecognition`
    or `webkitSpeechRecognition`. A runtime `service-not-allowed` (Safari with Siri and
    Dictation off, possibly home-screen mode) hides it for the session with "Talking isn't
    available here. Type instead." No `speechSynthesis` just means replies aren't spoken.
  - **The iOS gesture rule.** `recognition.start()` and the silent priming utterance must run
    synchronously inside the pointer or key event, so nothing on the path
    `TalkKey.onHoldStart → startTalking → provider.listen` may `await`.
  - **Tests.** Unit tests inject `test/voice/fake-voice.ts`; jsdom has no Web Speech. Headless
    Chromium's recognition can't hear, so the e2e specs install fake globals with
    `e2e/fake-voice.ts` (`page.addInitScript`) and drive them through `window.__fakeVoice`.

## The 3D renderer (`src/renderer/`)

three.js through React Three Fiber, lazy-loaded as its own chunk (`SceneCanvas`), so the
shell's first paint doesn't wait for it. Without WebGL 2 (and in jsdom) the model area keeps
the CSS dot-grid floor, labelled as "3D isn't available".

- **Where the model comes from.** The open project's `ProjectSession` (see Projects above)
  makes the `CommandBus` on `TIER1_CATALOG`; `src/state/model-store.ts` mirrors `bus.project` (it follows every execute,
  undo, redo and restore) and holds renderer-only state: the selection and its label, parts in
  progress, and a proposal. `?sample=pool-house` builds the 16 × 20 shell from the core acceptance test
  (`src/model/sample-shell.ts`); add `&context=1` for a stippled house and tree.
- **Drawing.** Every part is a box, so parts are batched by `materialId|sectionId`
  (`batches.ts`) into one `InstancedMesh` each (`PartBatch.tsx`). Batches are structurally
  shared like the project: an edit only rewrites the matrices of parts whose reference changed.
  Scene units are metres (mm ÷ 1000 at the matrix). Materials (`materials.ts`) come from the
  catalog swatch plus the KTX2 texture set at real-world scale, with box UVs whose u axis runs
  along the board, so grain follows each board, plus a small per-board variation.
- **The view rules** are pure functions in `visibility.ts`: Floors (Foundation / Floor 1 /
  Roof, mapped onto assembly kinds while a project has one level) and Look from (Inside removes
  the roof and cuts walls, openings and structures at 4′ 0″, with the cut faces drawn dark).
  The slider's heights come from the model (`src/model/floor-stops.ts`).
- **The floor and site.** A bounded dot-grid floor around the build, a compass on the floor
  near its front corner, site context (`place_structure`) drawn stippled, a sun placed with
  `suncalc` from the site's location, and dimensions as hairlines with `′ ″` labels.
- **Pointing.** A tap (one pointer, ≤ 6 px, ≤ 500 ms) selects a part, and a drag orbits
  (`picking.ts`). The selection and the parts Claude is working on get orange outlines only,
  never fill; a proposal is a dashed orange box. Escape clears the selection.
- **Camera.** Orbit, pan, and wheel or pinch zoom toward the pointer (`OrbitControls` with
  `zoomToCursor`). The camera fits the build once and then never moves on model edits. The
  zoom readout is the fitted distance over the current one.
- **Motion.** The canvas renders on demand (no frames at rest), so it stays cool on phones.
  New parts drop in over 250 ms unless the user prefers reduced motion, which also turns off
  orbit damping.

Scene colours come from `tokens.json` too: `SCENE_COLORS` in the generated `tokens.ts`.

### Quality tiers

`quality.ts`: phones (coarse pointer, < 900px) start on **low**, other touch devices (iPad) on
**medium**, everything else on **high**. The tier sets the pixel-ratio cap, the shadow map
size, ambient occlusion (off / half / full), MSAA or SMAA, and whether normal and roughness
maps load. While the user interacts, a governor steps the tier down on slow frames and back up
with headroom, with a limit on flip-flops. For device testing:

- `?perf` shows frames per second and the tier.
- `?tier=low|medium|high` forces the starting tier.

### Snapshots

`renderSnapshot(request)` (from `src/renderer/index.ts`) renders a PNG of the model for Claude
(ADR-0002 §B10). It draws a separate scene offscreen in the same WebGL context, so **the
user's camera and view never move**. The request (`zSnapshotRequest`) takes:

- `angle`: `sheet` (default: top, front, right and 3D on a 2 × 2 sheet), `top`, `front`,
  `back`, `left`, `right`, `iso`, or `{ frame: '<part or assembly id>' }`;
- `mode`: `textured` (default), `blueprint` or `xray`. Blueprint and x-ray exist only for
  snapshots, not in the UI (ADR-0003 §C). `stress` and `exploded` are rejected with a plain
  sentence;
- `highlight` (part ids, outlined orange), `labels` (ID labels), `dimensions`, `lookFrom`,
  `floor`, and `size` (long edge, 256–2048 px, default 768).

Unknown ids are rejected with suggestions. Requests are served one at a time, with a 10 s
timeout. Wiring it into the agent's `snapshot` tool is a later ticket.

### Debugging and e2e

In dev, or with `?e2e`, `window.__slapdash` exposes `renderSnapshot`, `camera()`,
`selection()`, `select()`, `frameStats()` and the bus (plus the 2D sheet's keys, merged in by
`src/debug.ts`). Playwright runs Chromium with
SwiftShader (`--use-angle=swiftshader`) so WebGL 2 works headless; `e2e/renderer.spec.ts`
checks drawing, tap versus drag, Inside and Floors, and that snapshots leave the view
untouched. Snapshot PNGs are saved to `test-results/screens/`.

To check on real devices, run `pnpm --filter @slapdash/web dev --host` and open
`http://<lan-ip>:5173/?sample=pool-house&perf`.

### The stress view (`src/analysis/`, LOC-113)

Stress On (3D only) colours every part by how close it is to its limit, from the solver
in a Web Worker (`analysis/solver.ts`, one client; the view uses the `'view'` channel and
Claude's `check_structure` the `'claude'` channel, so neither cancels the other).

- `useStressAnalysis` (mounted once in `ModelArea`) re-analyses 300 ms after the project
  or the site defaults change, keeps the last result on screen while a new one runs, and
  pauses in 2D. State lives in `stress-store.ts`.
- `stress.ts` has the rules: five equal bands (`stress-1` … `stress-5` tokens), "over"
  (ink, paper hatching, warning mark), "not checked" (a 25% paper ghost), the callout on
  the most loaded visible part ("Header, South wall · about 90% of its limit", nearest 5%)
  and when Claude explains unprompted.
- When Stress goes on and the first result has the worst part at 80% or more, anything
  over or anything unstable, `stress-explain.ts` runs one automatic chat turn (shown as a
  "Stress view on" chip): Claude calls `check_structure`, explains, and offers the fix
  first when over the limit (`resize_header` for a header). Once per switch-on, only when
  the keyhole has confirmed Claude is configured and nothing else is running.
- `shell/StressLegend.tsx` shows the ramp, the status, the design loads with their
  sources (the person's own get the orange dot and "Yours") and the planning-estimate
  disclaimer; compact on the phone.

**Where the loads come from.** `state/site-store.ts` holds the site defaults: the default
location from `GET /api/claude` (`SLAPDASH_DEFAULT_LOCATION` on the server, never in the
bundle) and `DESIGN_LOAD_TABLE` from `@slapdash/catalog`. The bus (builders size headers),
the solver, Claude's `<project>` summary and the legend all read the same values. Without
a keyhole there is no default location, and the solver's 30 psf / 115 mph fallbacks show
with "no location set".

`window.__slapdash.stress` (dev and `?e2e`) exposes the stress state and `execute(name,
input)` on the current bus, so e2e can undersize a header and resize it.

## The 2D drawing sheet (`src/drawing/`)

**View 2D** swaps the model for a drawing sheet (ADR-0003 §C/§D). It is plain SVG with no
three.js, so it is in the main chunk and works without WebGL. The 3D canvas stays mounted
but hidden, so snapshots keep working.

- **Layout.** The plan, cut at 4′ 0″ (the Inside cut height), is in the middle. North is
  above it, South below, West on the left and East on the right, with a 4′ gap, and a north
  arrow sits above and to the right of the plan. Everything is on a 1′ dot grid with a 4′
  margin, snapped to whole feet. An empty build shows "Nothing to draw yet."
- **Conventions.** Sheet units are model mm. The plan has north up. Elevations are upright
  and drawn as seen from outside, so the North elevation has east on the left and the East
  elevation has north on the right.
- **What is drawn.**
  - In plan, cut walls are dark bands taken from the wall recipe. Each opening whose rough
    opening spans the cut leaves a gap with a symbol: glass lines for a window, two panels
    for a sliding door, a leaf and swing for a door. Other cuttable parts are drawn as their
    section, the foundation and floors as outlines, and the roof and ridge dashed overhead.
  - In elevation, each assembly is the convex hull of its parts. They are painted by kind
    (foundation, floor, walls, roof) and then far to near, and footings are clipped at the
    ground line. Openings in walls that face the viewer get their rough opening and a
    symbol.
- **Dimensions** (the Dimensions control).
  - Plan: every wall's length outside it, every opening's width, and the footprint under
    the title.
  - Elevations: the wall height (right) and the ridge height (left), each opening's
    "W × H", and a pitch triangle (`6 in 12`) where the slope lies in the view plane.
  - Labels are `′ ″` with 45° ticks.
- **Floors** applies, and Look from doesn't. Site context isn't drawn on the sheet yet.
- **Pan and zoom.** Drag to move. Scroll, trackpad-pinch or two-finger pinch zooms toward
  the pointer, between 25% and 800% of the fit. When focused, the arrow keys pan, `+`/`-`
  zoom and `0` fits. The readout shows the zoom, where 100% is the fit. The view
  (`sheet-view-store.ts`) survives switching to 3D and back, and is refitted only when a
  project is opened or first gets parts.
- **One drawing, two outputs.** `buildSheet(project, { floor, dimensions })` (`sheet.ts`)
  returns the sheet as plain data, memoised per project. `DrawingSheet.tsx` renders it on
  screen, and `drawingSheetSvg(project)` (`svg.ts`) renders it as a standalone SVG file for
  page 1 of the exported PDF. The export uses hex colours and sheet-unit sizes, with no
  `var(--…)`. Sizes and colours are all in `style.ts`. Text is tuned to at least 14 CSS px at
  the fitted zoom on the 1440 × 900 desktop; on a phone you pinch in.
- **Debugging.** With `?e2e` or in dev, `window.__slapdash.sheet()`, `sheetView()` and
  `sheetSvg()` are available. `e2e/sheet.spec.ts` writes `test-results/screens/sheet.svg`.

Builder recipes (wall, opening and roof params) are read defensively in
`src/model/recipes.ts`, which both the 3D dimensions and the sheet use.

## Materials, cut list and PDF (`src/materials/`, `src/export/`)

The **Materials** key opens a modal (ADR-0003 §F) with two tabs in a track beside the title.

- **Data.** `useMaterials()` runs core's `takeoff(project, catalog, PRICE_TABLE)` once per
  immutable project (a WeakMap), so the two tabs and the PDF share one result. A
  `set_price` from Claude changes the project, so the list updates live.
- **Materials tab.** The total as a range under the title, then one `<table>` per build step
  (Slab, Walls, Roof…; the step is the `<caption>`, Amount and Cost are column headers), a
  swatch per row, "no price yet" in grey (the reason is the tooltip), an orange dot on a
  price the person gave, and a Total row. The footer has Export PDF and the price-table
  date. Words and numbers are in `format.ts`.
- **Cut list tab.** One table per stock board ("From 2×4 precut studs, 8′ 8 5/8″ — 59
  boards"), each row a piece length and count; spliced pieces say so.
- **The modal rule.** It mounts inside `<main>` (`role="dialog" aria-modal="false"`) and never
  makes the chat inert. On desktop it sits below the header's keys, so the latched Materials
  key still closes it; on phone it fills the screen under the Chat key (z 3) and the chat
  sheet (z 20). Escape and Close return focus to the Materials key. The tab lives in the
  shell store, so it survives crossing the breakpoint.
- **Export PDF** (`export-pdf.ts`, loaded on click) builds a US letter PDF and downloads
  `<project-slug>.pdf`. `layoutPdf` (`pdf-layout.ts`) is pure: page 1 is the name, specs and
  the 2D sheet as vectors (`pdf-sheet.ts`, no dot grid); page 2 the materials list with the
  Total, date and caveat; page 3 the cut list in two columns with a tick box per row. Each
  section starts a new page, a long list carries over with "(continued)" headers, and every
  page has a footer with "Planning estimate, not a quote" and "Page n of N". `renderPdf`
  (`pdf-render.ts`) draws it with pdf-lib in its own lazy chunk.
- **Fonts.** Geist Regular and SemiBold static TTFs are vendored in `src/export/fonts/` (SIL
  OFL 1.1, `OFL.txt`; from the official `geist` package, v1.9.2) and fetched only on export.
  Characters the font lacks are swapped for ASCII stand-ins (′ → ', × → x); if the fetch
  fails, the PDF is set in Helvetica through the same sanitizer.
- **Checking a PDF by eye.** `SLAPDASH_PDF_OUT=/tmp/pool-house.pdf pnpm --filter @slapdash/web
  exec vitest run test/export` writes the pool house's PDF. `e2e/materials.spec.ts` downloads
  it through the real button.

## Tokens and the raw-value rule

`scripts/build-tokens.ts` reads `docs/design/tokens.json` (validated with zod) and writes
`src/styles/tokens.css` (custom properties) and `src/styles/tokens.ts` (`PHONE_BREAKPOINT_PX`,
which can't be a CSS variable inside `@media`). Both are generated and committed; never edit
them by hand. Change `tokens.json`, then run `pnpm --filter @slapdash/web tokens`.

Components use only `var(--…)` from that file. `test/no-raw-values.test.ts` fails on hex,
`rgb()`/`hsl()`, named colours, raw `font-size`, raw durations, `px` values other than `0`/`1px`
hairlines, and orange (`--color-signal`) text. The one runtime colour is the material
`Swatch`, which comes from catalog data. `test/tokens.test.ts` fails if the generated files are
stale, and `test/contrast.test.ts` checks the WCAG ratios of every text/background pair the
shell uses.

## Deviations from the handoff (LOC-104)

- **14px minimum text.** `key` and `label` were raised from 13px/12px to 14px (20px line height)
  in `tokens.json`.
- **44px minimum touch target.** Phone corner keys are 44px rather than the handoff's 40px, and
  desktop keys, radio options and slider stops are at least 44 × 44 too (`--size-touch`).
- **Values with no token** (chat panel width, touch target, swatch, focus ring, breakpoint,
  motion durations and easings) were added to `tokens.json` as `size` and `motion` groups.
- **Held Talk key label is paper, not ink.** Ink on `signal-pressed` is only 3.68:1, so while
  Talk is held its label and icon turn `paper` (4.73:1). At rest, text on orange stays ink
  (4.86:1), as the handoff says.

The design artifact needs the same edits.
