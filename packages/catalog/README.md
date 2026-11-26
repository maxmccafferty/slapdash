# @slapdash/catalog

The tier-1 catalog (ADR-0001 Appendix A, "enough to build a pool-house shell"), the dated
price table (§11) and CC0 textures (§6). It is data: JSON files checked against the schema
in `@slapdash/core` (ADR-0002 §E2).

```ts
import { TIER1_CATALOG, PRICE_TABLE, TEXTURE_SETS } from '@slapdash/catalog';

new CommandBus({ project, catalog: TIER1_CATALOG });
PRICE_TABLE.researchedOn; // "2026-11-25", shown with every cost
```

`src/index.ts` imports the JSON (import attributes, no build step), runs `validateCatalog`
and `validatePriceTable` once and throws a plain-language list if anything is wrong, so the
app can't start on a broken catalog.

## What's here

| Path | Contents |
|---|---|
| `data/materials/*.json` | One file per Appendix A group: lumber, engineered wood, sheet goods, concrete and masonry, fasteners and hardware, roofing, envelope, insulation, openings, site. Load order is fixed in `src/index.ts`. |
| `data/sections.json` | Actual dressed sizes in mm: 1x/2x/4x/6x lumber, LVL, glulam, I-joists, rebar, CMU. Sections sold in board lengths list them in `stock` (precut studs, 8′–20′ boards) for the cut list; glulam and CMU have none. |
| `data/joint-types.json` | Nails, screws, bolts, lags, anchors, hangers, ties, post bases, embedded/cast-in-place, mortared, notched, mortise-and-tenon. Each names its `hardwareId` and a `source`. |
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
- Prices are US national big-box retail, low–high across retailers and common sizes.
  Entries that can't be priced credibly are `unpriced` with the reason.

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
covers. Fasteners, insulation, glass, window and door units, underlayment and flashing
tape use their swatch colour only. Credits are in `textures/ATTRIBUTION.md`.

## Changing it

See [CONTRIBUTING.md § How to add a material](../../CONTRIBUTING.md#how-to-add-a-material).

```sh
pnpm --filter @slapdash/catalog test        # tier-1, Appendix A, prices, textures, builders
pnpm --filter @slapdash/catalog typecheck
pnpm --filter @slapdash/catalog textures    # rebuild textures (needs KTX-Software's `ktx`)
```
