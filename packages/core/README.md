# @slapdash/core

The parts-and-joints model, the catalog schema, the command bus with undo, and units.
Pure TypeScript with one runtime dependency (`zod`). No DOM, React or Three.js. It runs in
the browser, in a Web Worker and in plain Node (`node scripts/smoke.ts`, no build step).

See ADR-0001 §3–4 and ADR-0002 §A1–A9, §D3, §E5 and §F7 in `docs/adr/`.

## Coordinates and units

- **y-up, millimetres.** The origin (0,0,0) is the project's fixed ground corner. By
  convention this is the south-west corner, with +x east and +z south, so a top view
  reads like a plan.
- Positions are world-absolute. A part's `position` is its start (min) corner. The part
  runs along its local x axis (`size.length`). Local y is `size.width` and local z is
  `size.height`. `rotation` is in degrees, applied intrinsically in X, then Y, then Z.
- A sectioned member (e.g. a `2x4`) takes width and height from the catalog section.
  Only its length is free.
- One ground level, `L0`, exists now. Assemblies and parts carry `levelId`, so storeys
  can be added later without a migration.
- Every length input accepts a JSON number (mm) or text with a unit:
  `"16ft 6in"`, `"16' 6\""`, `"5 1/2in"`, `"4877mm"`, `"4.877 m"`. A bare numeric string
  such as `"16"` is rejected as ambiguous, except zero (`"0"`, which is 0 mm in any
  unit). Text wrapped in matching quote marks (`"\"9ft\""`, `“16ft 6in”`) is read without
  them; a lone trailing `"` is still an inch mark. Use `parseLength`, `formatFeetInches`,
  `formatLength` and `formatBoth` for conversions. Roof pitch uses `parsePitch` and
  `formatPitch` (`"6 in 12"`).

## IDs

Readable and stable. Claude, snapshot labels and the user share them.

| Thing    | Pattern                       | Example  |
|----------|-------------------------------|----------|
| Assembly | `<KindCode><n>`               | `W2`     |
| Part     | `<assemblyId>-<RoleCode><nn>` | `W2-S07` |
| Joint    | `J<nnnn>`                     | `J0012`  |

Kind codes are in `KIND_CODES` and role codes are in `ROLE_CODES` (`src/model/ids.ts`). IDs come
from per-project counters that only move forward. Undo and restore never roll the counters
back, so a deleted ID is never handed out again. A part keeps its ID even if its role or
assembly changes later.

## The command bus

```ts
import { CommandBus, createProject, SAMPLE_CATALOG } from '@slapdash/core';

const bus = new CommandBus({ project: createProject({ name: 'Shed' }), catalog: SAMPLE_CATALOG });
bus.group({ label: 'Build the south wall', source: 'claude', turnId: 't1' }, () => {
  bus.execute('add_assembly', { name: 'South wall', kind: 'wall' });
  bus.execute('add_part', {
    assemblyId: 'W1', role: 'stud', materialId: 'spf-no2', sectionId: '2x4',
    position: { x: 0, y: 0, z: 0 }, length: '92 5/8in',
  });
});
bus.undo(); // undoes the whole group
```

- `execute(name, input)` runs schema validation, then semantic checks, then apply, then
  records the inverse. It returns `{ ok: true, summary, created }` or
  `{ ok: false, errors }`. Each error is a plain-language `CommandError` that Claude can
  act on (`formatErrors` joins them).
- A failed command changes nothing and is not recorded. Inside a group it does not abort
  the group.
- `beginGroup`/`endGroup`/`group` collect commands into one undo step. Nested groups
  flatten into the outer one, and an empty group records nothing. Calling
  `undo`/`redo`/`restoreVersion` while a group is open first commits what the group has
  so far, then runs, then reopens a fresh group with the same label.
- `listHistory`, `saveVersion`, `listVersions` and `restoreVersion` are also available. A
  restore is its own undo step, so it can be undone.
- `subscribe(fn)` fires once per execute, undo, redo and restore.
- `serialize()` and `CommandBus.hydrate()` turn history and named versions into plain data
  and back. `@slapdash/storage` (`packages/storage`) uses them to persist projects.
- `rename_project` sets `project.name`. It is undoable like any other command.
- Project states are immutable and deep-frozen. Unchanged entities keep reference
  equality across edits.

`commandJsonSchemas()` returns `{ name, description, input_schema }` for every exposed
command plus the history tools (`undo`, `redo`, `list_history`, `save_version`,
`list_versions`, `restore_version`). `packages/agent` generates Claude's tools from these.

## Builders

Builder tools hold the carpentry knowledge (ADR-0002 §A4). Claude says *what* to build
("a 20ft wall, 9ft tall, sliding door here"); deterministic code lays out every stud,
header, joist, fastener and joint, US platform framing with nominal lumber.

| Tool | Makes |
|---|---|
| `pour_slab` | Slab on grade with thickened-edge footings (`FD1`) |
| `build_wall` | A whole stud wall with plates, studs, openings, sheathing or let-in braces (`W1`) |
| `add_opening` | A window or door framed into a builder wall (`O1`, framing goes in the wall) |
| `frame_floor` | Platform floor: sills or piers, rims, joists, blocking, subfloor (`F1`) |
| `build_roof` | Gable or shed stick-framed roof on the walls (`R1`) |
| `build_fence` | Posts in concrete, rails and boards (`M1`) |
| `place_structure` | Site context: an existing house, pool, tree, shed or box (`X1`), no joints |

Wall conventions (also in the `build_wall` tool description):

- `start` and `end` are plan points (`{ x, z }`) on the **outside face of the framing**.
  Walls may run at any plan angle.
- The exterior is on the **left** walking from `start` to `end` in a north-up plan, so
  walls listed clockwise face outward. `exterior: "right"` flips it.
- `height` is the overall framed height, bottom of the bottom plate to the top of the
  double top plate: `"9ft"` gives 103 1/2in studs. `studLength` overrides it.
- The wall stands on the highest slab or floor under it, or on the ground (the summary
  says which). Sheathing projects outward from the framing face by its thickness.
- An end that lands on the end of an existing wall's outside face butts into it as a
  California corner: its framing is shortened by that wall's depth, its sheathing laps
  past, and a flat backer stud is added to the through wall. Studs are always laid out
  16/24in on center from the wall's `start`.

Header sizes come from IRC 2021 Table R602.7(1) (`HEADER_TABLE`, `pickHeader` in
`src/builders/rules.ts`), using the project's ground snow load or 30 psf, and the building
width (input, or the short side of the slab under the wall). `findClashes` /
`findAllClashes` (`src/model/clash.ts`) check parts against each other with a 1 mm
tolerance; every builder refuses to run new parts through existing ones.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for how builders are put together, how to add
one, and a reference for each.

## Catalog and prices

Core defines the shapes only: the catalog (`zCatalog`, `validateCatalog` in
`src/catalog/`) and the dated price table (`zPriceTable`, `validatePriceTable` in
`src/catalog/prices.ts`). Materials point into the table with `priceKey`; the table carries
one `researchedOn` date and a `source` note per entry. The real tier-1 data lives in
`@slapdash/catalog` (`packages/catalog`). `SAMPLE_CATALOG` is placeholder test data used by
core's tests and the smoke script, not design values.

Structural values in the catalog are inputs to `@slapdash/solver`. `structural` holds
unadjusted NDS reference values, and the solver applies the adjustment factors. A joint
type's `behaviour` (`pinned` or `fixed`) and `capacity` drive both the frame solver and
the stability sim. A sheet material's optional `shearPanel` block (SDPWS apparent shear
stiffness and allowable unit shear) is what lets a `brace:panel` sheet brace a wall or a
roof. A new sheathing material needs it to act as bracing.

A project can carry the person's own prices in `project.prices` (keyed `materialId` or
`materialId|size`), set with `set_price` and removed with `clear_price`. They replace the
table's range for that project only; undo restores the whole map through the internal
`set_prices`.

## Materials and cut list

`takeoff(project, catalog, priceTable)` (`src/materials/`) gives the materials list, the cut
list and the totals from one computation, so the Materials tab, the Cut list tab and the PDF
always agree.

- **Steps.** Rows are grouped by build step, from each part's assembly: Slab (a `pour_slab`
  foundation) or Foundation, Floor, Walls (walls and their openings), Roof, Fence,
  Structures. Site context is left out. Steps are ordered by the earliest build phase of
  their parts, then in that fixed order. Hardware comes from the joints (`hardwareId`, per
  fastener or per joint) and goes with the **later** of its two parts' steps, so a
  hurricane tie is bought with the roof. `buildStepGroups` is exported for the Build steps
  screen.
- **Counting.** Sectioned lumber, engineered wood and steel with `stock` lengths are bought
  as boards; without stock, by the linear foot. Sheet goods are one 4×8 sheet per piece,
  sized by thickness to 1/32in ("23/32in"). Concrete is rounded up to the next 1/4 yd³.
  Everything else is measured in the unit it is priced in.
- **Cut list.** `cutStock` (`optimizer.ts`) packs each (step, material, section)'s pieces
  into its stock lengths: a piece longer than the longest stock is spliced into equal
  segments; a piece within `TRIM_MM` (1 1/4in) of a stock length gets that board whole
  (103 1/2in studs on 104 5/8in precuts); the rest go first-fit decreasing (longest first,
  ties by id) onto the longest stock with a `KERF_MM` (1/8in) kerf between cuts, and each
  board is then cut down to the shortest stock that holds it. Offcuts aren't shared across
  steps, so each step's board counts add up to the cut list.
- **Prices.** Boards are priced at their full length per linear foot; a key with no sizes
  ignores the row's size. The person's own price wins (low = high); a per-board price
  becomes per foot for other lengths, and a per-ft² sheet price is 32 ft² a sheet. A row
  with no price keeps the reason (the table's `unpriced` note, a missing size). Money is
  summed in cents and rounded to dollars only for display.

## Adding a command

See [CONTRIBUTING.md § How to add a command](../../CONTRIBUTING.md#how-to-add-a-command).

## Scripts

```sh
pnpm --filter @slapdash/core test        # vitest (node environment)
pnpm --filter @slapdash/core typecheck   # src without DOM or Node types, then tests/scripts
pnpm --filter @slapdash/core smoke       # node scripts/smoke.ts
```
