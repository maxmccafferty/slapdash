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
pnpm smoke                               # node packages/core/scripts/smoke.ts
pnpm dev                                 # the web app (apps/web, Vite)
```

Architecture decisions live in `docs/adr/`. `packages/core` is pure TypeScript with no DOM,
React, Three.js or Node APIs in `src/` (`test/no-dom.test.ts` enforces it).

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
4. Run `pnpm --filter @slapdash/web test`, and `pnpm --filter @slapdash/web e2e` for layout,
   focus, axe and reduced-motion checks (install Chromium once with
   `pnpm --filter @slapdash/web exec playwright install chromium`).
