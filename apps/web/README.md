# @slapdash/web

The Slapdash web app (Vite + React + TypeScript, ADR-0002 §E1–E2). For now it is the **app
shell**: the frame around the model and the chat, built from the design handoff
(`docs/design/HANDOFF.md`, ADR-0003).

```sh
pnpm dev                                   # from the repo root; or:
pnpm --filter @slapdash/web dev            # Vite dev server
pnpm --filter @slapdash/web test           # unit tests (vitest, jsdom)
pnpm --filter @slapdash/web typecheck
pnpm --filter @slapdash/web build
pnpm --filter @slapdash/web tokens         # regenerate src/styles/tokens.{css,ts}
pnpm --filter @slapdash/web exec playwright install chromium   # once
pnpm --filter @slapdash/web e2e            # Playwright: layout, 44px targets, 14px text, focus, axe, reduced motion
```

E2E is not part of `pnpm -r test`, so the workspace tests stay headless. It saves screenshots
of each state to `test-results/screens/` for comparison with the handoff artboards (Braun,
Mobile, MobileViews, MobileFloors, MobileChat).

## What the shell is (and isn't)

- **Desktop (≥ 900px):** logo and the Save/Load, Undo/Redo, Materials/Steps units top left;
  project name and four ruled specs; the Floors slider top right; the four view controls
  bottom left; the zoom readout bottom right; the chat panel on the right (408px, fluid down to
  320px between 900px and about 1200px).
- **Phone (< 900px):** project name and specs top left; one vertical unit of icon-only keys
  (Project popover with Save/Load/Undo/Redo, Materials, Build steps, Floors popover) top right;
  the eye key (view controls popover) bottom left; the orange chat key bottom right, which opens
  the chat as a bottom sheet while the model slides up. No logo.
- **Not here yet:** the 3D scene (the model area is an empty dot-grid floor), chat behaviour and
  voice, the Materials/Steps/Projects modals (only their latched keys), and real spec values.

UI state (view controls, floor, latched panel, phone popovers and sheet) lives in a Zustand
store, `src/state/shell-store.ts`. It never holds project data.

## The `ShellActions` seam

Save, Load, Undo and Redo call `ShellActions` (`src/shell/actions.ts`), which `App` takes as a
prop and defaults to no-ops. Later tickets wire the command bus and `ProjectStore` there, in one
place.

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
