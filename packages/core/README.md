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

## Adding a command

1. Write a `defineCommand({ name, description, exposed: true, schema, check, apply })` in
   `src/commands/<area>.ts`.
   - `schema` is a `z.strictObject`. Use `zLength`/`zPositiveLength`/`zVec3Input` for
     lengths and `.describe()` every field, because these descriptions become Claude's
     tool docs.
   - `check(project, input, ctx)` is pure and returns `CommandError[]`. Use `notFound(...)`
     for "did you mean" hints and `formatBoth(mm)` for lengths in messages.
   - `apply(project, input, ctx)` is pure and returns `{ project, inverse, redo, summary,
     created }`. Build `inverse` with `putWithInverse`/`removeWithInverse` or the internal
     `set_site`/`replace_project`. `redo` is the *resolved* input, with generated IDs and
     mm values filled in.
2. Add it to the area's list, which `src/commands/registry.ts` collects.
3. Add tests to `test/commands/`: the happy path, the inverse restoring the exact
   pre-state and redo reproducing the post-state (`expectRoundTrip`), each semantic error,
   and one schema error. Add a generator to `inverse.property.test.ts`.

## Scripts

```sh
pnpm --filter @slapdash/core test        # vitest (node environment)
pnpm --filter @slapdash/core typecheck   # src without DOM or Node types, then tests/scripts
pnpm --filter @slapdash/core smoke       # node scripts/smoke.ts
```
