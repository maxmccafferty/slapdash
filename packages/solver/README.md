# @slapdash/solver

Structural checks for a Slapdash project (ADR-0001 §5, ADR-0002 §E5–E6). It answers two
questions:

- **Is it overstressed?** `analyze(project, catalog, options)` is a linear 3D frame
  solver with NDS 2018 (ASD) member checks, joint checks and shear-panel checks under
  dead, live, roof live, snow and wind.
- **Will it tip over?** `simulateStability(project, catalog, options)` from
  `@slapdash/solver/stability` is a Rapier rigid-body sim that runs on demand.

Both read the same parts-and-joints model and the same `pinned` / `fixed` joint flags
from the catalog. The code is pure TypeScript with no DOM and no Node APIs in `src/`
(`test/no-dom.test.ts` enforces it). It runs in a Web Worker (`./worker`) or in Node.

```ts
import { analyze } from '@slapdash/solver';
import { CATALOG } from '@slapdash/catalog';

const r = analyze(project, CATALOG);
r.parts['W1-S03'];   // { utilization: 0.42, governing: { check: 'combined', combo: 'D+0.6W+x' }, … }
r.joints['J0614'];   // { utilization: 0.31, governing: { check: 'joint-uplift', … }, forces_N, capacity_N }
r.unstable;          // [{ assemblyId: 'W2', message: 'W2 racks: it needs sheathing or a let-in brace …' }]
r.loads.roofSnow;    // { value, unit: 'kPa', source: 'ASCE 7-22 §7.3–7.4: …' }
```

Units are N, mm and MPa (N/mm²). Results are keyed by the project's own part and joint
IDs. Every load value carries its source, so Claude can say where a number came from.

## Entries

| Export | What |
|---|---|
| `@slapdash/solver` | `analyze`, the result types, `LOAD_COMBINATIONS`, `DEFAULT_WIND_SPEED_MS`, the ASCE 7 helpers |
| `@slapdash/solver/stability` | `simulateStability`. It loads Rapier (`@dimforge/rapier3d-compat`, Apache-2.0) lazily, so the main entry never pulls in the WASM |
| `@slapdash/solver/protocol` | Message types and `handleSolverMessage(state, msg)`, the whole worker logic, testable in Node |
| `@slapdash/solver/worker` | The Web Worker entry. In the web app: `apps/web/src/analysis/solver-client.ts` and `solver-worker.ts` |

## The analytical model

- **Members.** Parts whose material has `structural` values (except sheathing) become
  Euler–Bernoulli beam elements along the section centroid, with the part's own local
  axes. A part is split at every joint along it. `brace:diagonal` parts are trusses
  (axial only).
- **Rigid ground.** Concrete or masonry joined to `GROUND` (a slab, footings, piers),
  and concrete joined to that. A joint to it, or straight to `GROUND`, is a support. A
  plate resting on a slab bears along the whole strip the slab covers.
- **Joints** are link elements between the joint's projections onto the two members'
  centrelines. Translations are tied by a stiff penalty spring (10⁴ × the stiffest
  member). Rotations are tied as stiffly for `fixed` joint types; for `pinned` ones a
  spring 10⁻⁹ times that only removes zero-energy spin modes. **The eccentricity between
  the two centrelines is ignored**, and there are no semi-rigid joints.
- **Shear panels.** A `brace:panel` sheet whose material has `shearPanel` (SDPWS Ga and
  allowable unit shear) becomes a pure-shear panel element. Its four corners snap to
  nodes on the framing it is nailed to, and its racking stiffness is `Ga·b/h`. This
  replaces the X of equivalent diagonals the plan first named: diagonals also resist
  uniform squash, so a sheet would carry gravity load meant for the studs
  (`src/fem/panel.ts`). A sheet without `shearPanel` carries load but braces nothing,
  and the result includes a warning saying so.
- **Mass only.** Everything else (roofing, siding, openings, insulation, trim) has no
  stiffness. Its weight goes through its joints to the framing as a uniform line load
  over the stretch it covers, never as point loads.
- **Unconnected** parts or islands that never reach the ground are left out, with a
  warning.

The global stiffness is assembled in skyline (profile) storage after reverse
Cuthill–McKee renumbering and factored once with an in-place LDLᵀ. Each basic case is
one back-substitution; combinations are linear superpositions.

**Mechanisms.** A zero pivot means a part with nothing holding it (`status:
'mechanism'`). A soft mechanism, such as an unbraced pinned wall racking, shows up as
displacements past `max(H/50, 100 mm)`, with most of the work stored in the pinned
joints' stabilising springs. Its parts are marked `unstable` with a plain message. A
structure that moves that far but stores the energy in its members is only "very
flexible", which is a warning.

## Loads and combinations

| Case | What |
|---|---|
| `D` | Self-weight (density × volume, or areal mass × face), plus optional superimposed dead |
| `L` | 40 psf (1.92 kPa) on floor sheathing |
| `Lr` | 20 psf (0.96 kPa) on roof sheathing, on the horizontal projection |
| `S` | `ps = Cs·0.7·Ce·Ct·Is·pg`, with Ce = Ct = Is = 1 and Cs for a warm roof (ASCE 7-22 Fig. 7.4-1). `pg` comes from the project's override, then the loads-table row for the location (`DESIGN_LOAD_TABLE` in `@slapdash/catalog`, passed as `siteDefaults.table`), then the app fallback, otherwise 30 psf; the source says which |
| `W±x`, `W±z` | `qh = 0.613·Kz·Kzt·Kd·Ke·V²` (exposure C, Kd = 0.85). Simplified envelope: windward wall +0.8, leeward −0.5, roof −0.9 normal to the surface, side walls not loaded. `V` comes the same way (project, loads table, app fallback), otherwise 115 mph |

An assembly with no sheathing takes its area loads straight on its rafters, joists or
studs, over the builder's spacing (default 16 in).

The ASD combinations of ASCE 7-22 §2.4.1 each carry an NDS load-duration factor `CD`:
D (0.9), D+L (1.0), D+Lr (1.25), D+S (1.15), D+0.75L+0.75(Lr or S), D+0.6W (1.6),
D+0.75L+0.75(0.6W)+0.75(Lr or S) (1.6) and 0.6D+0.6W (1.6). The wind combinations are
expanded over the four directions.

## Checks

- **Members (NDS 2018 ASD).** Adjustments: CD; CF (Table 4A size factor, lumber only);
  Cfu; Cr = 1.15 for studs, joists and rafters at ≤ 24 in; CP with le between braced
  points (weak axis 0 when sheathed). **CL = 1** (the compression edge is taken as braced
  by sheathing). Checks: biaxial bending, shear at 1.5V/A, axial tension or compression,
  combined (NDS 3.9-1 / 3.9-3), and bearing perpendicular to grain at supports.
- **Deflection (IRC R301.7).** Floor joists L/360 under L. Rafters L/240 with a
  ceiling, otherwise L/180. Headers, beams and ridges L/240. Studs H/180 under wind.
- **Joints.** The link force is resolved into withdrawal (along the contact normal),
  shear and uplift (on `partIds[0]`). Capacity is the catalog value, overridden field by
  field by `capacityOverride`, × `fastenerCount` for `per-fastener` values, × CD for
  nails, screws and bolts. Uplift values are Simpson's 160% values, so they scale by
  `CD / 1.6`. A direction the catalog gives no capacity for isn't checked, and the
  result notes it.
- **Panels.** Unit shear `v = Ga·|γ|` against `vAllowable` (SDPWS wind ÷ 2.0).

`utilization` is demand ÷ capacity for the governing check (> 1 fails), and `governing`
names the check and the combination.

## Stability sim

Each part is a cuboid with its material's density. Parts joined by `fixed` joints are
merged into one body; rigid ground is a fixed body. `pinned` joints are spherical
joints. A sheet's joint to a member is two spherical joints at the ends of the stretch
the sheet covers. Member-to-member pins sit on the longer member's centreline, as in the
frame solver. Parts don't collide with each other; a catcher 100 mm below the lowest part
stops anything that falls. Gravity gets a 2% sideways component (a notional load) so a
balanced mechanism still shows itself. The sim runs for 3 s at 60 Hz with 8 solver
iterations.

The verdict is `collapses` when joined bodies turn more than 5° against each other or a
loose part falls, `tips` when bodies turn more than 5° together, and otherwise `stable`.
`movedParts` lists parts that moved more than 10 mm or turned more than 1°.
`recordEvery` keeps poses for a later playback UI. Joints don't break in v1.

## Tests and performance

```sh
pnpm --filter @slapdash/solver test        # kernel, textbook cases, AWC-method spans, loads, braces, joints, pool house, stability, protocol
pnpm --filter @slapdash/solver typecheck
pnpm --filter @slapdash/solver bench       # analyze() on the pool-house shell, 10 runs
```

The pool-house acceptance test asserts `stats.ms` under 1000 ms. Set
`SOLVER_PERF_BUDGET_MS` to scale the budget on slow CI.

`test/fixtures/awc-spans.ts` currently holds spans computed by hand with AWC's published
span method. Its header says so: the AWC calculator couldn't be read automatically.
Replace the values with the calculator's output and set `verifiedAgainstAwc: true`.

## Cross-checking against other solvers

AGPL solvers such as Stabileo may be used **only as an outside check**: model the same
frame by hand in their UI and compare displacements. Copy no code or data from them, and
add no dependency.
