# Contributing to Slapdash

## Getting started

- Node ≥ 22.18 (see `.nvmrc`) and pnpm (the version is pinned in `package.json`;
  `corepack pnpm …` works if pnpm isn't installed globally).
- `pnpm install`, then:

```sh
pnpm -r test                             # every package's tests
pnpm -r typecheck                        # every package's typecheck
pnpm --filter @slapdash/core test        # core only (vitest, node environment)
pnpm --filter @slapdash/core typecheck   # core src without DOM or Node types, then tests/scripts
pnpm --filter @slapdash/catalog test     # the tier-1 catalog, prices and textures
pnpm --filter @slapdash/solver test      # the structural solver and stability sim
pnpm --filter @slapdash/solver bench     # time analyze() on the pool-house shell
pnpm smoke                               # node packages/core/scripts/smoke.ts
pnpm dev                                 # the web app (apps/web, Vite) plus /api/claude
pnpm check:secrets                       # build the web app and prove no API key reaches it
pnpm build:api                           # bundle the Claude keyhole for Vercel
```

Architecture decisions live in `docs/adr/`. `packages/core` is pure TypeScript with no DOM,
React, Three.js or Node APIs in `src/` (`test/no-dom.test.ts` enforces it). So is
`packages/solver` (the frame solver and the Rapier stability sim, run in a Web Worker by
the web app; see its README), whose only exception is the worker entry `src/worker.ts`.

## How to add a command

1. Write a `defineCommand({ name, description, exposed: true, schema, check, apply })` in
   `packages/core/src/commands/<area>.ts`.
   - `schema` is a `z.strictObject`. Use `zLength`/`zPositiveLength`/`zVec3Input` for
     lengths (and `zPlanPoint` for plan points, `zPitch` for roof pitch), and `.describe()`
     every field, because these descriptions become Claude's tool docs.
   - `check(project, input, ctx)` is pure and returns `CommandError[]`. Use `notFound(...)`
     for "did you mean" hints and `formatBoth(mm)` for lengths in messages.
   - `apply(project, input, ctx)` is pure and returns `{ project, inverse, redo, summary,
     created }`. Build `inverse` with `putWithInverse`/`removeWithInverse`/`patchWithInverse`
     or the internal `set_site`/`replace_project`. `redo` is the *resolved* input, with
     generated IDs and mm values filled in, so re-applying it recreates the same IDs.
2. Add it to the area's list, which `src/commands/registry.ts` collects.
3. Add tests to `packages/core/test/commands/`: the happy path, the inverse restoring the
   exact pre-state and redo reproducing the post-state (`expectRoundTrip`), each semantic
   error, and one schema error. Add a generator to `inverse.property.test.ts`.

## How to add a builder

Builders are commands that hold carpentry knowledge (ADR-0002 §A4). They live in
`packages/core/src/builders/` and are registered in `src/commands/builders.ts`.

### The pattern: layout → emit → command

1. **Layout** (`src/builders/layout/<thing>.ts`): a pure function
   `(project, input, catalog) → LayoutResult`. It either refuses (`fail(commandError(…))`)
   or returns a `Layout`: the assemblies, parts and joints to create, described with local
   **keys** (`"#w"`, `"#m12"`) instead of IDs, plus any existing entities to remove, notes and
   a `summary(resolve)` function. Lay members out as boxes in a `PlanFrame`
   (`src/geometry/frame.ts`: u along the thing, v up, w across) and turn them into parts
   with `placeMember` / `placeOriented`, the single place frame coordinates become a
   part's position and rotation. `SpecList` collects specs with sequential keys.
2. **Emit** (`src/builders/emit.ts`): `emit(project, layout)` allocates readable IDs in a
   fixed order (assemblies, then parts in layout order, then joints) and returns plain
   entities. Layout is deterministic, so `check` and `apply` see the same result.
3. **Command** (`builderCommand({ name, description, schema, layout })` in
   `src/commands/builders.ts`): `check` runs the layout, `checkCatalogRefs` (every material,
   section and joint type exists, sections suit their materials, both sides of each joint
   accept it) and the clash check. `apply` re-runs the layout, emits, and applies the
   result with `patchWithInverse`.

### Rules every builder follows

- **Redo is the patch.** A builder's `redo` is `{ name: 'patch_entities', input: { put,
  remove, counters } }`, not its own name and input: undo never rolls ID counters back, so
  re-running the layout after an undo would allocate new IDs. Re-applying the patch
  recreates exactly the same IDs.
- **Store the recipe.** Put the fully resolved input (lengths in mm) on the assembly as
  `builder: { name, params }`. Later builders read it: `add_opening` re-frames a wall from
  its `build_wall` recipe, `build_wall` finds corners from other walls' recipes, and
  `build_roof` finds bearing walls. Keep params JSON-plain (use `null`, not `undefined`).
- **No clashes.** New parts are checked against existing parts (`findClashes`, 1 mm
  tolerance, touching faces are fine). Parts in a builder's own output are trusted (let-in
  braces overlap studs on purpose); parts the same patch removes are ignored; a layout can
  add exemptions with `clashSkip` (site context ignores other site context). The refusal
  names what would be hit: `The new wall would run through X1 "Existing house" (X1-X01).`
- **Catalog defaults.** Default material, section and joint-type IDs live in
  `BUILDER_DEFAULTS` (`src/builders/defaults.ts`); every builder takes a `materials`
  override object. `test/builders/catalog-defaults.test.ts` checks the sample catalog has
  them all, and `packages/catalog/test/builders.test.ts` checks the tier-1 catalog has
  them all and builds the acceptance shell on it.
- **Code tables with citations.** Prescriptive rules (header spans, king studs, anchor
  bolts, nailing) are data in `src/builders/rules.ts`, each with a comment citing the table
  it came from. Transcribe from the published text, not from memory, and spot-check values
  in `test/builders/rules.test.ts`.
- **Build phases.** Every part gets a `buildStep` whose phase matches its assembly (walls:
  `framing`, their sheathing `sheathing`; roofs `roofing`; floors `floor`; slabs
  `foundation`; fences and site context `site`; opening assemblies `openings`), with `seq` =
  how many assemblies that builder had already made.
- **Every part is joined.** Each part gets at least one joint (to another part or to
  `GROUND`). Framing that touches face to face gets joints from `contactJoints`
  (`src/builders/contact.ts`): 16d nails for framing, 8d nails for sheathing at 6in on edges
  and 12in in the field. The one exception is site context (`place_structure`), which is not
  structural and has no joints.
- **Plain-language refusals.** A refusal is information (ADR-0002 §A7). Use
  `commandError`/`notFound` with the field's `path`, give numbers in feet and inches (`fi`
  in `src/builders/util.ts`), and say what would work: `The opening needs 4 1/2" more room
  at the east end for the king and jack studs.`
- **Summaries** are one paragraph: what was built, with IDs and the key numbers, then any
  notes about assumed values (`Headers are sized for the default 30 psf ground snow load…`).

### Tests a builder needs

- A test file in `test/commands/builders/`: the happy path with exact counts worked out in
  comments, `expectRoundTrip`, each refusal message, and one schema error.
- A generator in `test/commands/inverse.property.test.ts` (refusals are fine; they are
  skipped).
- If it adds to a whole-building flow, extend `test/builders/shell.acceptance.test.ts`.

### Future builder work (out of scope in v1)

Gable-end wall studs under the rafters, hip roofs, stairs, gates, multi-storey framing
(`levelId` stays `L0`), non-rectangular slabs and floors, modelled birdsmouths, and
removing an opening.

## How to add a material

The tier-1 catalog is JSON in `packages/catalog/data/`, checked against the schema in
`packages/core/src/catalog/` when `@slapdash/catalog` is imported. Units: MPa, kg/m³,
kg/m², RSI per mm, N.

1. **Pick the file** in `packages/catalog/data/materials/` for its ADR-0001 Appendix A
   group. Ids are lower-case kebab (`df-l-no2`) and are never renamed once shipped:
   projects store them.
2. **Fill in the numbers**, in SI:
   - `structural` (`E_MPa`, `Fb_MPa`, `Fv_MPa`, `Ft_MPa`, `Fc_MPa`, `Fc_perp_MPa`) for
     anything used as a beam or post: lumber, engineered wood, steel members. Use NDS
     Supplement **reference** values, unadjusted (psi × 0.00689476).
   - `strength` (`compressive_MPa`, `E_MPa`, `yield_MPa`, `tensile_MPa`) for concrete
     (f'c), masonry (f'm) and rebar (fy).
   - `shearPanel` (`Ga_N_per_mm`, `vAllowable_N_per_mm`, `nailing`, `source`) for sheet
     goods that brace walls or act as roof and floor diaphragms: SDPWS Table 4.3A apparent
     shear stiffness (kips/in × 175.127) and the ASD wind allowable (vw ÷ 2.0, plf ×
     0.0145939) for one nailing schedule. Without it the solver treats a `brace:panel`
     sheet as weight only and warns that it braces nothing.
   - `density_kg_m3` (NDS specific gravity or manufacturer data), `arealMass_kg_m2` for
     products whose thickness isn't modelled (shingles, siding, membranes; psf ×
     4.88243), `rValuePerMm` for insulation (labelled R × 0.17611 ÷ thickness in mm, or R
     per inch × 0.0069335).
   - `source` citing the table each number came from. **Transcribe from the published
     table; don't recall.**
   - `description`: one or two plain sentences Claude can quote, including caveats
     ("generic approximation; size from the manufacturer's table").
3. **Joints and flags.** `acceptsJoints` lists existing joint types (add one with "How to
   add a joint type" below). `flags` come from `KNOWN_FLAGS` in
   `packages/catalog/src/flags.ts`; add a flag there, with its meaning, if you need a new
   one.
4. **Look.** Always give a `swatch` (`#rrggbb` lower-case, optional `roughness`,
   `metalness`, `opacity`); it is the untextured colour and tints the texture. For a
   `textureSet`, reuse one from `textures/manifest.json` where it reads right, or add a set:
   a CC0 asset from Poly Haven or ambientCG, with its real-world `tileSize_mm` (from the
   asset page, or a `tileSizeNote` saying how you estimated it), then run
   `pnpm --filter @slapdash/catalog textures <set-id>` (needs KTX-Software's `ktx` CLI) and
   commit the `.ktx2` files and the regenerated `ATTRIBUTION.md`. Keep each file under
   1.5 MB and the folder under 25 MB.
5. **Price.** Set `priceKey` (`<group>.<id>`, e.g. `lumber.df-l-no2`) and add entries to
   `data/prices.json` in the unit parts are measured in (lumber per linear foot by section
   variant, sheets per sheet by thickness, hardware each, coverings per square foot…), with
   a `source` note naming the retailers, products and raw prices. If it can't be priced
   credibly, add an `unpriced` entry with the reason. Don't change `researchedOn` for one
   new entry; put the date you looked in the `source` instead.
6. **Test.** If it fulfils an Appendix A item, add it to
   `packages/catalog/test/appendix-a.test.ts`. Run `pnpm --filter @slapdash/catalog test`.

Builders take the first `opening` material that accepts `nailed-16d` as their window/door
unit, so the generic `opening-unit` stays first in `openings.json`.

A new **section** in `data/sections.json` that is sold in board lengths gets a `stock` list,
shortest first: `{ "length_mm": … }`, with `"name": "precut stud"` for precuts. The cut-list
optimizer packs pieces into these lengths; a section without `stock` is cut to length.

### How to add a joint type

Add it to `packages/catalog/data/joint-types.json`:

- `category` and `behaviour` (`pinned` or `fixed`, ADR-0002 §E5; there are no semi-rigid
  joints).
- `capacity` in N, ASD allowable at normal load duration, for SPF/Hem-Fir unless the
  `source` says otherwise; `basis` is `per-fastener` (multiplied by the fastener count) or
  `per-joint`. Connector uplift is published at 160%: record it as published and say so.
- `hardwareId`: the `fastener` material it consumes (one per fastener, or one per joint),
  so the materials list can count and price it.
- `source`: the published table (NDS, ICC-ES ESR, manufacturer catalog). Where nothing is
  published, start it with `Estimate:` and give the reasoning, and add the id to
  `ESTIMATED_JOINTS` in `packages/catalog/test/tier1.test.ts`, so made-up numbers can't hide.
- Add the id to `acceptsJoints` of every material that takes it.

### Refreshing the price table

Re-research every entry, not just a few, so the table keeps one honest date. Update the
`source` notes, set `researchedOn` to the day of the research and `CATALOG_VERSION` in
`packages/catalog/src/index.ts` to the same day, and land it in one commit.

## Builder reference

Lengths accept `"16ft 6in"`, `"9'"`, `"5 1/2in"`, `"4877mm"` or a number in mm. Plan points
are `{ x, z }` from the ground origin (+x east, +z south). Every builder takes an optional
`name` and `materials` (`lumber`, `treatedLumber`, `sheathing`, `subfloor`, `concrete`).

### `pour_slab`

- **Inputs:** `from`, `to` (opposite plan corners), `thickness` (default 4in), `top`
  (top-of-slab elevation, default 4in), `thickenedEdge` (default true).
- **Lays out:** one `slab` part and, with thickened edges, four 12in-wide `footing` parts
  around the perimeter (north and south full length, east and west between them), down to
  the project's frost depth or 12in, whichever is deeper.
- **Joints:** slab ↔ each footing and each footing ↔ `GROUND`, `cast-in-place`; without
  thickened edges, slab ↔ `GROUND`.
- **Build phase:** `foundation`. Assembly `FD<n>`.
- **Refuses:** no area; thinner than 3 1/2in; a side over 100ft; too small for thickened
  edges; a clash.

### `build_wall`

- **Inputs:** `start`, `end`, `height` (or `studLength`), `exterior` (`left`), `baseElevation`,
  `studSize` (`2x4`│`2x6`), `spacing` (`12in`│`16in`│`19.2in`│`24in`), `loadBearing` (true),
  `buildingWidth`, `bracing` (`sheathing`│`let-in`│`none`), `openings` (as `add_opening`).
- **Lays out:** a bottom plate (pressure-treated on concrete or ground), a top plate and a
  cap plate; end studs and common studs centred on multiples of the spacing from the wall
  start, skipping any within 3/4in of an end stud; openings; 4×8 7/16in OSB panels on the
  outside face with joints on studs (horizontal sheets at 19.2in), cut around openings; or
  1x4 let-in braces at 45–60° at each end. Corners as in the conventions above, with a
  `corner-backer` stud in the through wall.
- **Joints:** contact nailing (stud ↔ plates 2-16d, plate ↔ cap face-nailed, corner studs
  to each other, sheathing 8d at 6/12in); bottom plate ↔ slab `anchor-bolt` (IRC R403.1.6
  count) or nailed to the floor joists and rims; let-in brace 2-8d at each stud and plate.
- **Build phase:** `framing` (`seq` = wall order), sheathing `sheathing`. Assembly `W<n>`.
- **Refuses:** zero length; less than two stud spaces of framing; under 4ft tall; studs past
  20ft stock; a corner part-way along a wall, at an angle, from outside, or with the
  exterior facing in; openings that don't fit; no room for let-in braces; bad materials; a
  clash.

### `add_opening`

- **Inputs:** `wallId`, `kind` (`window` 36×48in │ `door` 38×82 1/2in │ `sliding-door`
  72×80 1/2in), `at` (near edge of the rough opening from the wall start) or `centerAt`,
  `width`, `height`, `sillHeight` (windows; default puts the head at 82 1/2in).
- **Lays out:** in the wall, removes only the common studs within 3/4in of the new kings;
  adds king studs (IRC Table R602.7.5), jack studs (NJ from IRC Table R602.7(1)), a built-up
  header on edge (the shallowest section, then fewest plies, whose span covers the opening,
  plies limited to the wall depth; a flat 2x4 in non-bearing walls up to 8ft, R602.7.4),
  cripples above the header on layout, and for windows a flat sill with cripples under it.
  Doors cut the bottom plate between the jacks. Sheathing panels crossing the rough opening
  are replaced by cut panels. Also creates an `O<n>` assembly holding the opening's recipe.
- **Joints:** contact nailing of all new framing and panels to the wall, plus anchor bolts
  for any new bottom-plate pieces. Joints of removed parts are removed.
- **Build phase:** framing parts `framing` in the wall; the `O<n>` assembly `openings`.
- **Refuses:** unknown wall; a wall not made with `build_wall`; past the wall end ("needs
  4 1/2in more room at the east end…"); overlapping another opening's framing; through a
  let-in brace; too tall for the wall with its header; past the header or king-stud tables
  (snow over 70 psf, building over 36ft, span past the largest header); a window sill at or
  below the floor; a clash.

### `frame_floor`

- **Inputs:** `from`, `to` (outside of the rims), `top` (top of subfloor), `joistSize`
  (`2x8`), `spacing` (`16in`), `joistDirection` (`x`│`z`, default across the shorter side),
  `support` (`foundation`│`piers`).
- **Lays out:** two band rims at the joist ends and two end joists; joists on layout; a
  mid-span blocking row when the span is over 8ft; 2x6 pressure-treated sill plates under
  the bands (or 12in concrete piers at most 6ft apart); 23/32in plywood subfloor, 4×8 sheets
  across the joists, staggered.
- **Joints:** joist/end joist ↔ band 3-16d; contact nailing elsewhere; sill ↔ foundation
  `anchor-bolt`; pier ↔ `GROUND` `cast-in-place`, band ↔ pier `post-base`; subfloor 8d.
- **Build phase:** `floor`. Assembly `F<n>`.
- **Refuses:** nothing under a bearing edge (with `foundation`); edges on supports at
  different heights; joists past the 20ft stock length; `top` too low, or leaving a gap
  above the foundation; joists under 6in above grade on piers; a clash.

### `build_roof`

- **Inputs:** `type` (`gable`│`shed`), `from`, `to` (wall footprint, outside face of the
  framing), `pitch` (1–24 in 12), `ridgeAxis` (gable; default along the longer side),
  `lowSide` (shed), `rafterSize` (`2x6`), `spacing` (`16in`), `overhang` (12in), `rake` (0;
  adds fly rafters), `bearingHeight` (default from the walls under the eaves), `sheathing`
  (true).
- **Lays out:** gable: rafter pairs at each layout mark from the footprint corner plus the
  ends, a ridge board one size deeper with its top flush with the rafter tops, and a rafter
  tie at plate level beside each pair. Shed: rafters from the low wall over the high wall,
  no ridge. Rafter undersides pass through the outside face of the wall sheathing at plate
  height (birdsmouths not modelled). 4×8 OSB roof panels on the rafter tops, staggered.
- **Joints:** rafter ↔ ridge 3-16d; rafter ↔ cap plate `hurricane-tie` plus 3-16d toenail;
  tie ↔ rafter 4-16d heel joint; tie ↔ plate 16d; roof sheathing ↔ rafters 8d.
- **Build phase:** `roofing`. Assembly `R<n>`.
- **Refuses:** pitch outside 1–24 in 12; no walls under an eave and no `bearingHeight`;
  eave walls at different heights; rafters past the 20ft stock length ("A 6 in 12 gable roof
  over 36' 0" needs 21' 2 1/16" rafters…"); shed high walls too low or too high, with the
  height they need; a clash.

### `build_fence`

- **Inputs:** `path` (two or more plan points), `height` (6ft; 3–8ft), `style`
  (`privacy`│`picket`), `postSpacing` (8ft max).
- **Lays out:** pressure-treated 4x4 posts at every path point and evenly at most
  `postSpacing` apart, set half their height (at least 2ft) below grade in 12in concrete
  piers; 2x4 rails between posts (3 over 5ft tall, else 2); 1x6 privacy boards edge to edge,
  or 1x4 pickets with 3 1/2in gaps, on the outside of the rails.
- **Joints:** post ↔ pier `post-embedded`; pier ↔ `GROUND` `cast-in-place`; rail ↔ post
  2-16d each end; board ↔ each rail 2-8d.
- **Build phase:** `site`. Assembly `M<n>` (kind `misc`).
- **Refuses:** fewer than two points; repeated points; over 8ft ("fences over 8ft need
  engineering and usually a permit") or under 3ft; posts more than 8ft apart; a clash.

### `place_structure`

- **Inputs:** `kind` (`house`│`pool`│`tree`│`shed`│`box`), `at` (footprint corner, or trunk
  centre for trees), `width`, `depth` (plan), `height`, `poolDepth`, `canopy`, `rotation`
  (plan degrees).
- **Lays out:** simple boxes in material `site-context`, role `other`, tagged
  `site-context`, `stippled` and `kind:<kind>`: a house body plus one box for its roof
  volume; a pool box below grade; a tree trunk and a canopy box.
- **Joints:** none. Site context is not structural; this is the one exception to "every
  part is joined".
- **Build phase:** `site`. Assembly `X<n>` (kind `structure`).
- **Refuses:** non-positive sizes; a canopy smaller than the trunk; a clash with built parts
  (overlapping other site context is allowed).

## App shell and design tokens

The web app lives in `apps/web` (see its README). Its colours, type, spacing, radii, shadows,
sizes and motion come only from `docs/design/tokens.json`:

1. Edit `docs/design/tokens.json`, then run `pnpm --filter @slapdash/web tokens` to regenerate
   `apps/web/src/styles/tokens.css` and `tokens.ts`. Commit both; never edit them by hand.
2. In component CSS use only `var(--…)`. `apps/web/test/no-raw-values.test.ts` fails on hex,
   `rgb()`, named colours, raw font sizes, raw durations and `px` values other than 1px hairlines.
3. Keep text at 14px or more and every control at least 44 × 44 (`--size-touch`).
4. Modals (Materials, Build steps and Projects) mount inside `<main>` with
   `aria-modal="false"` and never make the chat inert; `test/chat/chat.test.tsx` checks it.
   The Materials modal and the PDF export are described in the web README.
   So are Projects, first run and Build steps.
5. Run `pnpm --filter @slapdash/web test`, and `pnpm --filter @slapdash/web e2e` for layout,
   focus, axe and reduced-motion checks (install Chromium once with
   `pnpm --filter @slapdash/web exec playwright install chromium`).

### The shipped sample project

`apps/web/src/samples/pool-house.slapdash` is what **Open the sample pool house** imports. It
is generated from `SAMPLE_SHELL_COMMANDS` (`apps/web/src/model/sample-shell.ts`). After
changing a builder, the catalog defaults or the sample, run `pnpm --filter @slapdash/web
sample` and commit the file; `apps/web/test/projects/sample.test.ts` fails until you do.

## Renderer

The 3D view lives in `apps/web/src/renderer` (see the web app's README for its architecture).

- **A new material draws itself.** The renderer reads only the catalog entry: its `swatch`
  (colour, roughness, metalness, opacity; glass is anything with opacity below 1) and,
  optionally, its `textureSet` (KTX2 maps at `tileSize_mm`). Add those to the material (see
  "How to add a material") and it appears with grain along the board's length. There is no
  per-material renderer code. A material without a swatch is drawn neutral grey.
- **The view rules live in one place:** `visibility.ts` decides what Floors, Look from and
  Build steps show and where Inside cuts. Change it there, and update `test/renderer/visibility.test.ts`.
  The user's view and snapshots both use it.
- **Colour.** The model is the only colour. Orange (`signal`) is for outlines of the selection
  and parts being worked on, never fill. Scene colours come from `SCENE_COLORS` in the generated
  `tokens.ts`, never literals.
- **Tests.** Keep pure logic (batching, camera fit, dimensions, picking, snapshot requests) in
  plain modules with vitest tests in `apps/web/test/renderer/`; `scene.test.tsx` covers the
  scene graph with `@react-three/test-renderer`. Real WebGL is covered by
  `apps/web/e2e/renderer.spec.ts`.

## Claude server (keyhole)

The browser runs the agent loop; the server is a stateless keyhole (ADR-0002 §A6). It holds
the Anthropic API key, the system prompt, the tool list and the model choice, enforces the
per-user rate limit and the monthly budget (§D9), and streams Claude's reply. It stores
counters only, never anything about the project.

- **`packages/agent`** (browser and server): the system prompt (`src/system-prompt.ts`), the
  tool list (`src/tools.ts`, generated from the command schemas with `eager_input_streaming`,
  then the agent tools from `src/tools/schemas.ts`), the wire protocol (`src/protocol.ts`) and
  the agent loop (`src/loop.ts`, with its memory, guard and dispatch). Both prompt and tools
  are prompt-cached, so keep them byte-stable: no dates, no generated values, a fixed order.
  See `packages/agent/README.md` for the loop, the tools and how to add one.
- **`packages/keyhole`** (server only): config, pricing, budget, rate limit, usage stores and
  the `Request → Response` handler. `apps/web/src` must never import it or the Anthropic SDK;
  `apps/web/test/no-server-imports.test.ts` enforces that.
- **`api/claude.js`**: the Vercel function. It re-exports `packages/keyhole/dist/vercel.js`,
  which `pnpm build:api` bundles from `packages/keyhole/src/vercel-entry.ts` during the Vercel
  build (`vercel.json`'s `buildCommand`). The bundle is needed because Vercel's Node builder
  renames workspace `.ts` files to `.js` but leaves the `.ts` import specifiers, so the raw
  sources fail at runtime. The stub is tracked because Vercel finds functions before the
  build runs.

### Running it locally

- **`pnpm dev`**: the Vite dev server mounts the same handler at `/api/claude` (the
  `slapdash:keyhole` plugin in `apps/web/vite.config.ts`). It reads the repo-root `.env`
  with `loadEnv`, never into `define`. Counters go to `.data/usage.json` (gitignored), so a
  restart doesn't reset the month.
- **`vercel dev`** (after `vercel link`): runs the real function. Run `pnpm build:api`
  first and again after changing the keyhole.

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. The other variables are optional
and documented there: model, effort, max tokens, refusal fallback, monthly budget, rate
limits, allowed origins, the usage file and Upstash. Invalid numbers stop the server with a
plain message. Set the same monthly cap as the spending limit in the Anthropic Console; it is
the hard backstop.

### States the chat shows

| State | How the keyhole reports it | What the chat shows |
| --- | --- | --- |
| No API key | `GET` → `configured: false`; `POST` → 503 `{ error: 'not_configured' }` | "Claude isn't connected" with how to add the key and an Open the sample pool house key. The field and Talk are disabled. |
| Budget below 80% | `budget.state: 'ok'` | Nothing extra. |
| Budget at 80% or more | `budget.state: 'warning'` (GET, and the first stream event) | One muted note: "80% of this month's Claude budget is used: $8.00 of $10.00." |
| Budget at the cap | `POST` → 402 `{ error: 'budget_capped', budget }` with `resetsAt` (first of next month, 00:00 UTC). Claude is not called. | "Claude is back on December 1. Everything else keeps working." The field and Talk are disabled; the rest of the app works. |
| Rate limited | 429 `{ error: 'rate_limited', retryAfterSeconds }` and `Retry-After` | A note: "Too many messages. Try again in N seconds." |
| Claude failed mid-stream | an `error` event `{ error: 'upstream', message, retryable }` | A note asking to try again. The field stays usable. |
| Browser can't recognise speech | (browser, not the keyhole) no `SpeechRecognition`, not a secure context, or `service-not-allowed` at runtime | Talk is hidden; typing works as usual. The runtime case adds "Talking isn't available here. Type instead." once. |
| Microphone blocked | (browser) recognition error `not-allowed` | A note: "Slapdash can't use the microphone. Allow it in your browser's settings, or type instead." Talk stays. |

Modals cover the model area only; never make the chat inert. They mount inside `<main>`,
and on the phone the chat sheet stacks above them (see `apps/web/README.md`, Chat).

Spend is counted in integer micro-dollars from each reply's usage (`src/pricing.ts`; check
the table against the pricing page when prices change). Unknown models are priced at the most
expensive row. Spend is recorded when a reply ends, so concurrent requests can overshoot the
cap slightly; the Console limit covers that. A reply cut off before its final usage is
recorded with an estimate of its output tokens.

Counters live in a `UsageStore`: a JSON file in local dev, Upstash Redis when
`KV_REST_API_URL`/`KV_REST_API_TOKEN` are set, and memory (with a warning) on a deployment
without Upstash, where they reset on cold starts. Users are identified by a hash of their IP
until sign-in exists.

### Wire protocol

`GET /api/claude` returns `{ configured, model, budget }`. `POST /api/claude` takes
`{ messages }` only (a strict schema: the client cannot set the model, system prompt, tools
or limits) and returns `text/event-stream`:

```
event: budget     data: BudgetStatus               (first)
event: anthropic  data: BetaRawMessageStreamEvent  (passed through unchanged)
event: done       data: { budget, costUsd, model, stopReason }
event: error      data: { error: 'upstream', message, retryable }
```

Other errors are JSON: 400 `bad_request`, 403 `forbidden_origin` (an `Origin` that is neither
the app's host nor in `SLAPDASH_ALLOWED_ORIGINS`), 405, 413 `too_large`, and 500 `internal`
when the usage store fails. `parseKeyholeEvents()` in `@slapdash/agent` reads the stream.

### Evals

`pnpm eval` runs scripted scenarios through the real agent loop, headless in Node, against the
real Claude API, and checks the model that comes out. It goes through an in-process keyhole
(`evals/src/harness.ts`), so it needs no browser and no server. It reads `ANTHROPIC_API_KEY`
from the repo-root `.env` (or the environment) and costs real money, so run it before a
release or after changing the system prompt or tools, not per commit and not in CI. `evals`
has no `test` script on purpose: `pnpm test` never calls the API.

```sh
pnpm eval                                   # every scenario
pnpm eval --list                            # names and descriptions; no API call, no key needed
pnpm eval --only fence,undo                 # some scenarios
pnpm eval --only fence --repeat 3 --verbose # flaky model or wrong check? see the pass rate and tool log
pnpm eval --max-usd 1                       # spend guard for this run (default $3, or EVAL_MAX_USD)
pnpm --filter @slapdash/evals self-check    # offline: no key, no network, no spend
```

The in-process keyhole turns Supabase sign-in off (there is no browser to sign in from) and
raises the rate limits (set `EVAL_KEEP_RATE_LIMITS=1` to keep them). Model, effort and budget
are left alone, and spend is written to the same `.data/usage.json` as `pnpm dev`, so **eval
spend counts towards the month's budget**. Before running, the budget is printed; a capped
budget stops the run. Once this run's spend reaches `--max-usd`, or the keyhole reports the
budget capped, the remaining scenarios are reported as `SKIP` (the exit code is still 1).

| Scenario | What it proves |
|---|---|
| `pool-house` | Plan first, change nothing; "Build it" makes one undo step: 16×20 slab, four 9ft walls (103 1/2in studs). |
| `pool-house-sliding-door` | The ADR-0002 §D10 prompt: plus one sliding door on the south wall, ≥ 72in, with a header over it. |
| `fence` | 40ft privacy fence: posts ≤ 8ft apart, 6ft tall, ≥ 2 rails per bay, boards. |
| `shed-roof` | 3 in 12 shed roof sloping north on seeded shed walls; rafters joined to the plates. |
| `gable-roof` | 6 in 12 gable on seeded pool-house walls; ridge east-west, rafters in pairs. |
| `refuse-impossible-span` | A 20ft opening: refused in plain language (header/beam), alternatives offered, nothing changed. |
| `undo` | A window with no plan, then "undo that" restores the parts exactly and leaves it redoable. |
| `small-change-no-plan` | A 38in door 4ft from the north corner of the west wall: no plan, one undo step, header. |
| `plan-revision` | Plan a 12×16 floor, "Change something" to 10×14 (new plan, still no change), build 10×14 on piers. |
| `just-do-it` | "Don't ask me first" turns plans off (`set_preferences`) and builds a 10×12 shed shell in one step. |
| `clash-avoidance` | A tree on the fence line: Claude routes around it or offers options; nothing runs through the tree. |
| `question-no-change` | A question is answered (9ft) with no mutating tool and no change: the typical cheap turn. |
| `follow-ups-after-build` | Regression for replayed thinking signatures: plan and build the pool house, then a question (answers 9ft, changes nothing) and a 3ft east window (one undo step). Every turn must end with a real reply; an upstream error on any turn is an `ERROR`. |

Every scenario that builds also checks the result is sound: every joint passes the same checks
`connect` applies (`checkJoint` from core), every framing part is in at least one joint, and
nothing clashes. Edit scenarios start from models built by bus commands (`evals/src/seeds.ts`),
which costs no tokens. The self-check runs every check against correct builder output and
known-bad models, and runs the runner, usage tap, spend guard and report with a scripted
client, so a `FAIL` in `pnpm eval` points at the model rather than the check. Run it after
changing a check, a seed or a builder.

Every turn of every scenario also checks that **no tool call was rejected for bad input**: input
that couldn't be parsed, such as a length wrapped in quote marks (`"\"9ft\""`), a number with no
unit, a missing or unknown field, the wrong type or an unknown option. Claude retries after these,
so the scenario would pass anyway; this check catches the wasted round trips. Legitimate refusals,
such as a clash or a span no header can carry, are counted separately (`N refused`), and some
scenarios expect them. `classifyToolError` in `evals/src/harness.ts` tells the two apart by the
messages the parsers write. A scenario that deliberately sends bad input sets
`allowBadInput: true`. Its rejections still show in the turn line (`2 bad input`) and in the
summary's `Bad input:` total, so a regression stays visible.

Each turn prints its tools, whether Claude thought, tokens (input, output, cache read) and cost;
each scenario prints `PASS`/`FAIL`/`ERROR`/`SKIP` with plain reasons, and the tool log on
failure. A turn that ends in an error from Claude or the keyhole makes the scenario `ERROR`
(naming the turn and HTTP status), never a pass, and the run exits 1. Checks that match a length
in Claude's reply use `feetRe` from `checks.ts`, which accepts `ft`, `feet`, `'`, `′` and `’`. The summary has a
table, totals and a **cap check**: the average cost of a typical turn (small edits and
questions: `undo`, `small-change-no-plan`, `question-no-change`) and of a full build
(`pool-house`, `fence`, `just-do-it`), and how many of each the monthly cap
(`SLAPDASH_MONTHLY_BUDGET_USD`) buys. Every run writes `evals/results/<timestamp>.json`
(gitignored) with each turn's tokens, cost, tool calls and pass/fail, plus the model, effort,
git sha and the budget before and after, so releases can be compared.

If a scenario fails, rerun it with `--only <name> --repeat 3 --verbose`. Fix the check if the
model's behaviour was acceptable; if it wasn't, file a follow-up for the prompt or tools rather
than bending the scenario. To add a scenario, write it in `evals/src/cases/` with
`defineScenario`, add it to `evals/src/cases/index.ts`, and add its correct build to
`evals/src/self-check.ts`.

### Keeping the key out of the browser

`pnpm check:secrets` builds the web app with a sentinel `ANTHROPIC_API_KEY` in both
`process.env` and a `.env` file, then scans every emitted file for the sentinel, the variable
name, `x-api-key`, `api.anthropic.com` and `@anthropic-ai/sdk`. It fails and names the file
on any hit. Run it after touching the Vite config or anything that reads the environment.
