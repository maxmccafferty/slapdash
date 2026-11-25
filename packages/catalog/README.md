# @slapdash/catalog

The catalog, all three tiers of ADR-0001 Appendix A, plus the dated price table (§11), CC0
textures (§6) and the code-awareness flag vocabulary (§12). It is data: JSON files checked
against the schema in `@slapdash/core` (ADR-0002 §E2).

- **Tier 1, the pool-house shell:** lumber, engineered wood, sheet goods, concrete and
  masonry, fasteners and hardware, roofing, envelope, insulation, openings.
- **Tier 2, finishing it:** drywall, cement board, paint and stain; tile; flooring;
  plumbing (pipe by size, fittings, valves, traps, vents, fixtures, water heater);
  electrical (conduit, wire, boxes, receptacles, lights, subpanel); stone and brick; more
  openings (bay, bifold, barn, garage, skylight) and roofing (clear polycarbonate,
  clay/concrete tile, EPDM/TPO).
- **Tier 3, the yard:** fencing and gate hardware, decking and railings, outdoor pieces
  (shade sail, outdoor kitchen, pool pad and coping), steel shapes, HVAC extras, sealants,
  and site materials (landscape fabric, drain pipe). Pergolas, decks, sheds and the fence
  styles are built by `build_pergola`, `build_deck`, `build_wall`/`build_roof` and
  `build_fence`. Terrain, grading and property lines are site-context work (planned
  work item 11), listed as deferred in `test/appendix-a.test.ts`.

The tiers live in the data and the tests, not the export: everything is `CATALOG`.

```ts
import { CATALOG, PRICE_TABLE, TEXTURE_SETS } from '@slapdash/catalog';

new CommandBus({ project, catalog: CATALOG });
PRICE_TABLE.researchedOn; // "2026-11-25", shown with every cost
```

`src/index.ts` imports the JSON (import attributes, no build step), runs `validateCatalog`
and `validatePriceTable` once and throws a plain-language list if anything is wrong, so the
app can't start on a broken catalog.

## What's here

| Path | Contents |
|---|---|
| `data/materials/*.json` | One file per Appendix A group. Tier 1: lumber, engineered wood, sheet goods, concrete and masonry, fasteners and hardware, roofing, envelope, insulation, openings, site. Tier 2: interior, tile, flooring, plumbing, electrical, stone and brick (more openings and roofing are appended to tier 1's files). Tier 3: fencing, decking, outdoor, steel, HVAC and sealants. Load order is fixed in `src/index.ts`; tier 1 comes first so `opening-unit` stays the first opening. |
| `data/sections.json` | Actual sizes in mm: 1x/2x/4x/6x lumber, 2x2 balusters, 5/4x6 deck boards, LVL, glulam, I-joists, rebar, CMU, nominal pipe sizes (`pipe-*`, for plumbing and conduit), HSS tube, angle, W-shapes, a steel stud (`channel`), chain-link framework and 2x2 aluminum posts. Sections sold in board lengths list them in `stock` for the cut list; glulam, CMU, pipe and steel shapes are cut to length. |
| `data/joint-types.json` | Nails, screws, bolts, lags, anchors, hangers, ties, post bases, embedded/cast-in-place, mortared, notched, mortise-and-tenon; pipe fittings (glued, crimped, sweated, threaded, no-hub clamped), welded steel, gate hinges and latches, glass spigots and shade-sail mounts. Each names its `hardwareId` and a `source`; fittings and gate hardware are `"Estimate: …"` (no structural rating, listed so the materials list counts them). |
| `data/design-loads.json` | The design loads table: ground snow, wind speed and frost depth for US places, each value with its source (see below). |
| `data/prices.json` | The dated low–high price table, one `source` note per entry. |
| `textures/` | `manifest.json`, `<set>/<map>.ktx2`, and the generated `ATTRIBUTION.md`. |
| `scripts/build-textures.ts` | Downloads the manifest's sets and encodes them to KTX2. |

## Units and what the numbers are

- Stresses and moduli in MPa, density kg/m³, areal mass kg/m², thermal resistance RSI per
  mm (US R per inch × 0.0069335), joint capacities in N.
- Lumber and engineered wood carry **reference design values** (NDS Supplement tables,
  manufacturer literature), unadjusted. Size, wet-service, duration and other adjustment
  factors are the solver's job.
- Joint capacities are ASD allowable values at normal load duration, for SPF/Hem-Fir
  lumber unless the `source` says otherwise (connector uplift is published at 160%; we
  record it as published). Joint types with no published value say `"Estimate: …"`.
- Steel members carry `strength` (yield, E) and density, not beam values: the solver
  weighs them but doesn't check them yet ("steel has no beam values").
- Plumbing, electrical and HVAC are for the materials list only: they carry a mass (an
  effective density for devices and fixtures) and no structure.
- Every material that can be a part has a density or an areal mass, except tier 1's
  hardware, window and door units and the sonotube form, which predate the rule.
- Prices are US national big-box retail, low–high across retailers and common sizes.
  Coverings (brick, veneer, pavers, tile, flooring, membranes, fence fabric and panels,
  glass panels) are per square foot; pipe, conduit, wire, coping, cable rail and drain pipe
  per linear foot; paint and stain per square foot of coverage. Entries that can't be
  priced credibly are `unpriced` with the reason.

## Code-awareness flags

`src/flags.ts` (`KNOWN_FLAGS`) is the vocabulary: `ground-contact`, `safety-glazing`,
`not-safety-glazing`, `pool-barrier`, `not-pool-barrier`, `pool-gate-hardware`, `gfci`,
`receptacle-needs-gfci`, `wet-area-rated`, `not-for-wet-areas`, `licensed-trade`,
`thermal-barrier`, `heavy-roofing`. Tests reject any other flag and require every flag to be
used. The rules that read them need geometry, so they live in `@slapdash/core`
(`codeNotes`, `src/code/notes.ts`); Claude sees them in the `<project>` summary and when a
command creates one. They are reminders, not a code check.

**Planning estimates, not quotes, and not engineering values.** The catalog is good enough
to sketch, compare and get a rough cost; a permit set still needs a designer's numbers
and a supplier's quote (ADR-0001 Consequences).

## Design loads table

`DESIGN_LOAD_TABLE` lists ground snow load, design wind speed and frost depth for about two
dozen US places, keyed by normalised "City, ST". The app passes it to the builders, the
solver and Claude's `<project>` summary as `siteDefaults.table` (ADR-0002 §D3). The lookup
uses the resolved location: the project's own location (set with `set_site_location`) wins
over `SLAPDASH_DEFAULT_LOCATION`. A project's `set_design_load` overrides win over the table.

- **Where the numbers come from.** Each value was read from the jurisdiction's published
  design criteria (IRC Table R301.2 or R301.2(1) as adopted, or the state code where the
  state sets it), in November 2026. `sources` cites the document and `urls` gives the page.
  Wind speeds are ultimate design wind speeds (Vult, Risk Category II) because the solver
  uses the ASCE 7-22 velocity pressure. Older "basic" speeds were left out.
- **Partial rows are fine.** A value the source didn't settle is `null`: a site-specific or
  elevation-dependent snow load (Bend, Portland, Salt Lake City), a range, or a page that
  didn't say "ground". The app's fallbacks then fill in and say where they came from.
- **Planning data, not a code lookup.** Many cities vary by elevation or zone (Denver's wind
  is 115 mph east of Federal Blvd and higher further west). The building department's
  number is the one that counts, and a person can always override it with `set_design_load`.

### Adding a place

1. Find the jurisdiction's own published table: the city or county building department's
   "design criteria", the residential code amendments, or the state code.
2. Add a row to `data/design-loads.json`: `label` ("City, ST"), `groundSnowPsf`, `windMph`
   (ultimate, Vult), `frostDepthIn`, one `sources` entry and one `urls` entry per value
   given, and `retrieved` ("YYYY-MM"). Use `null` for anything you couldn't confirm. Don't
   estimate.
3. `pnpm --filter @slapdash/catalog test` checks the schema, sources, ranges and that the
   place isn't listed twice.

## Textures

Every set is CC0 1.0 from [Poly Haven](https://polyhaven.com) or
[ambientCG](https://ambientcg.com), downscaled to 1K and encoded to KTX2 (BasisLZ colour
and masks, UASTC + zstd normals, mipmapped). `tileSize_mm` is the real-world size one tile
covers. New sets ship colour, normal and roughness only (no AO) to stay small. The folder
budget is 35 MB, at most 1.5 MB a file. Swatch-only categories: fasteners, insulation,
openings, site, plumbing, electrical, mechanical, sealants and fencing (the aluminum fence
reuses `metal-galvanized`), plus a few clear, thin or wire-like ids listed in
`test/catalog.test.ts` (polycarbonate, membranes, underlayment, flashing tape, cable rail,
glass railing). Credits are in `textures/ATTRIBUTION.md`.

## Changing it

See [CONTRIBUTING.md § How to add a material](../../CONTRIBUTING.md#how-to-add-a-material).

```sh
pnpm --filter @slapdash/catalog test        # catalog, Appendix A, prices, textures, builders
pnpm --filter @slapdash/catalog typecheck
pnpm --filter @slapdash/catalog textures    # rebuild textures (needs KTX-Software's `ktx`)
```
