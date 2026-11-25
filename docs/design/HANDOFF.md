# Slapdash design handoff

**Date:** 2026-11-25
**Read with:** `docs/adr/0001-core-architecture.md`, `0002-model-claude-renderer-api.md`, `0003-app-design.md`

This is everything needed to build the Slapdash UI as designed. ADR-0003 records the decisions; this file is the practical guide: where the designs are, what each screen does, the values to use, and what in the mockups is real versus illustrative.

## Where things are

| What | Where |
| --- | --- |
| All screens (open the **Final** page) | https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv |
| Design system (tokens, components, logo) | https://claude.ai/artifact/BAXuWhXRh2xGm8qFsC1X8b |
| Tokens, in this repo | `docs/design/tokens.json` |
| Design system guide, in this repo | `docs/design/design-system.md` |
| Logo files, in this repo | `docs/design/logo/` |

The two links are private to the owner's Claude account. Everything a builder needs from them is copied into `docs/design/`; the canvas is the visual reference.

The canvas's **Explorations** page holds rejected directions. Ignore it.

## The look in one paragraph

Monochrome Braun. A plain white world; grey "units" hold every control, like the housing of a Braun radio; black type in Geist; the model is the only thing with colour. Orange (`#E8590C`) means exactly one thing: selected, or what Claude is working on right now. It is never decoration and never body text on white.

## Screens

Canvas links open the artboard. "Play" means the mockup responds to clicks.

### Desktop (designed at 1440 × 900)

| Screen | Link | Notes |
| --- | --- | --- |
| Main | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-Braun) | Play. The reference for layout and every control. |
| Materials and cut list | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-Materials) | Play. Modal over the model only; two tabs. |
| Projects (Load) | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-Projects) | Modal. Cards, New project, Import a .slapdash file. |
| Build steps | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-BuildSteps) | Play. Panel over the model; model shows the build up to the step. |
| Claude checks before a big change | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-Confirm) | Plan card, Build it / Change something, orange dashed outline on the floor. |
| Stress finds a weak spot | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-StressProblem) | Callout on the part, explanation, fix or leave it. |
| First run | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-FirstRun) | Empty site, "What are we building?", three starters. |
| First run, Claude not connected | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-FirstRunNoKey) | No API key. Input and Talk disabled; sample project still opens. |
| Sign in (hosted copy only) | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-SignIn) | Email and password, or passkey. No sign-up screen. |
| Chat states | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-ChatStates) | Talking, pointing at a part, can't do it, photo request, monthly limit. |

### Phone (designed at 390 × 844)

| Screen | Link |
| --- | --- |
| Main | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-Mobile) (Play) |
| Views open | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileViews) |
| Floors open | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileFloors) |
| Chat open | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileChat) |
| Stress on | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileStress) |
| Materials and cut list | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileMaterials) |
| Projects | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileProjects) |
| Build steps | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileSteps) |
| Claude checks before a big change | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileConfirm) |
| First run | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileFirstRun) |
| Sign in | [open](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-MobileSignIn) |

### Exported PDF (US letter)

Each section starts on its own page, so a long list can overflow onto more pages.

1. [Drawings](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-PDFExport): name, specs, plan and four elevations with dimensions.
2. [Materials](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-PDFExport2): the list with totals.
3. [Cut list](https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv#artboard-PDFExport3): grouped by board, a tick box per piece.

## Layout

**Desktop.** Model fills the window. Chat is a 408px panel on the right, inset 16px, full height.

- Top left: stud wall mark + `slapdash`, then three units: Save / Load, Undo / Redo, Materials / Steps.
- Below: project name (56px) and four ruled specs: footprint, walls, roof, parts.
- Top right of the model: Floors, a vertical slider with an orange knob (Roof / Floor 1 / Foundation, each with its height).
- Bottom left: four view controls, one unit each.
- Bottom right of the model: "scroll to zoom" and the zoom percentage, as plain text.
- Modals (Materials, Projects) cover the model area only. **The chat stays usable beside them.**

**Phone.** Corner buttons are icon-only, 40px keys inside units.

- Top left: project name and specs.
- Top right: one vertical unit: project (Save, Load, Undo, Redo in a popover), materials, build steps, floors. Popovers open to its left.
- Bottom left: eye icon, opens the four view controls.
- Bottom right: the orange chat key, opens the chat as a bottom sheet; the model slides up so it stays visible.
- No logo on phone screens.

**iPad and in-between widths** were not designed. Treat the chat panel width as fluid; below roughly 900px wide, switch to the phone pattern (chat as a sheet).

## Controls and behaviour

| Control | Options | Behaviour |
| --- | --- | --- |
| View | 3D / 2D | 2D swaps the model for the drawing sheet. |
| Look from | Outside / Inside | Inside cuts the walls at 4′ 0″ and removes the roof. Disabled in 2D. |
| Dimensions | On / Off | Hairline dimension lines with labels in feet and inches. |
| Stress | On / Off | Parts shaded light grey → orange by load; a legend appears. Disabled in 2D. |
| Floors | Roof / Floor 1 / Foundation | Hides everything above the chosen level. |

- A disabled control fades to 35% and takes no clicks.
- **Zoom is scroll or pinch only.** There is no zoom control. Zoom toward the pointer.
- **3D is view-only**: orbit, pan, zoom. No direct editing. The one touch interaction is **pointing**: tap a part to highlight it orange; it attaches to the next message as a chip ("Door header, south wall").
- **2D sheet**: plan (cut at 4′) in the middle, North above, South below, West and East either side, on a dot grid. Drag to move, scroll to zoom. Generated from the model, not from screenshots.
- **Compass**: drawn flat on the floor near its front corner (dotted ring, solid arrow to north, N E S W). It is part of the scene and turns with the model.
- **Parts being added** by Claude draw as orange outlines until placed.

## Conversation patterns

- **Small change:** applies at once; Claude says what it did, with an Undo key under the message.
- **Big change** (a new structure, a roof, about 50+ parts): Claude shows a plan card with **Build it** and **Change something**, and the planned shape appears as an orange dashed outline. "Just do it" turns the check off for that project.
- **Talking:** hold the orange Talk key. The field shows a waveform and "Listening"; the key reads "Let go"; words appear in the transcript as heard, unconfirmed words in grey.
- **Can't do it:** one sentence on why, two tappable ways that work, and "Nothing has changed yet."
- **Photo:** only when Claude asks. It says exactly what to shoot and offers Take photo / Choose photo. No general upload button.
- **Stress problem:** a callout on the part, a one or two sentence explanation, then fix or leave it.
- **Monthly limit:** a note in the chat at 80% of the budget; at the cap, the input is disabled and the chat says when Claude is back. Everything else keeps working.
- **No edit buttons anywhere.** Missing data shows in grey ("no price yet") and is filled by telling Claude.

## Materials

- Tabs: **Materials** and **Cut list**, in a two-option track beside the title.
- Materials: total as a range at the top; rows grouped by part of the build (Slab, Walls, Roof); each group header carries the Amount and Cost column labels; a round texture swatch per row; a Total row at the bottom.
- A price the user gave Claude shows with an orange dot and replaces the table price for that project.
- Cut list: grouped by the stock board the pieces come from; each row is a piece, its length and count.
- One **Export PDF** produces all three pages.

## Tokens

Full set in `docs/design/tokens.json`. Generate the app's CSS variables from that file so the two cannot drift. The essentials:

| Token | Value | Use |
| --- | --- | --- |
| `paper` | `#FFFFFF` | World, modals, transcript |
| `unit` | `#F1F1EF` | Every control housing, the chat panel |
| `track` | `#E2E2E0` | Inset track behind a two-option control |
| `key-line` | `#D4D4D2` | Borders on white keys and fields |
| `hairline` | `#ECECEA` | List row dividers |
| `ink` | `#1A1A1A` | Text, rules |
| `muted` | `#666664` | Labels and captions |
| `key-dark` | `#2B2B2B` | Primary keys: Build it, Next step, Send |
| `signal` | `#E8590C` | Selected / being worked on; the Talk key |
| `dot` | `#BFC5CD` | Floor dot grid, stippled site |

- **Type:** Geist only. 56 / 44 / 32 for titles (weight 400, tight tracking), 15 for chat, 14 lists, 13 keys, 12 labels.
- **Radius:** 7 keys, 10 fields and Talk, 12 small units, 16 panels, 24 chat panel and modals.
- **Spacing:** 4 between keys, 8 between units, 16 from the screen edge.
- **Text on orange is dark** (`ink`), not white.
- **Motion:** only in response to the user: knob slides 200ms, chosen-option piece snaps 180ms, parts drop in as Claude adds them. Respect reduced motion.

## Components

Described with live previews in the design system; summarised in `docs/design/design-system.md`.

- **Control unit**: grey housing. No border, no shadow when resting on the model.
- **Key**: white key in a unit. Latched state: inset shadow, bold label, orange dot.
- **View control**: small title over a two-option track; the chosen option is a raised white piece with an orange dot.
- **Talk button**: orange, 44px, same height as the text field; icon-only on phone.
- **Material swatch**: 18px round texture dot, drawn from the material's render colours.

## Logo

A stud wall: three thick studs under an orange top plate.

- `docs/design/logo/slapdash-mark.svg`: black studs, for white backgrounds.
- `docs/design/logo/slapdash-icon.svg`: app icon, white studs on black.
- `docs/design/logo/slapdash-icon-orange.svg`: alternate icon, black studs and white plate on orange.
- Lockup: mark at the wordmark's height, then `slapdash` in Geist 700, lowercase.
- Used in the desktop header, sign in and the PDF. Not on phone screens.

## What the renderer must support

- View-only orbit, pan, zoom.
- A level cut (Floors) and a 4′ section cut (Inside), with cut faces drawn dark.
- Stress overlay: a five-step ramp, three greys then two oranges.
- Dimension lines in feet and inches.
- Highlight for a pointed-at part; orange outline for parts in progress; orange dashed outline for a proposed structure.
- The floor: bounded, dot grid, with the compass on it.
- Site context (house, trees, pool) drawn stippled, not solid.
- The generated 2D sheet: plan and four elevations from the same model.
- Build steps: each builder tags its parts with a step.

## What in the mockups is illustrative, not real

Do not copy these as data.

- **The scene is a flat drawing**, not 3D. Orbiting, the Top/Front/Side feel and animation are not shown.
- **Stress shading and "about 90% of its limit"** are made up. Real values come from the solver.
- **Cut lengths** were worked out by hand for the pool house. Real ones come from the cut-list optimizer.
- **Prices** for studs, concrete, rafters and hurricane ties were checked against US retail in November 2026; the others are deliberately blank. The real table is ADR-0001 §11.
- **Part counts** (103 parts, 84 wall pieces) come from the mockup's own generator, not from real builders.
- **Chat text** is sample copy showing the voice, not fixed strings.

## Not designed

- iPad and mid-width layouts.
- Pointing on a phone (tap versus drag-to-orbit needs a rule; suggest tap = select, drag = orbit).
- The Save flow beyond the key (ADR: downloads a `.slapdash` file).
- Sign-up, password reset.
- Dark mode. There is one theme.
- The phone compass letters are small at the mockup's scale; size it for legibility when built.

## Left out on purpose

No settings screen (location and loads are configuration), no visible version history (Save and Load only), no problem report, no general photo upload, no blueprint / x-ray / exploded view modes. See ADR-0003 §J.

## Suggested build order

Follows ADR-0002 §D1, with the UI pieces attached to each phase.

1. **Foundation:** model, command bus with undo, builders, local store. UI: the shell (header units, chat panel, floor with compass), tokens wired from `tokens.json`.
2. **Renderer:** 3D scene, Floors, Inside cut, Dimensions, the 2D sheet. UI: the four view controls and the floor slider.
3. **Claude:** server keyhole, agent loop, voice. UI: chat, Talk, the plan card, pointing, can't-do-it, photo request.
4. **Materials:** catalog, price table, cut list, PDF. UI: the modal with both tabs.
5. **Physics:** solver and stress view. UI: the stress overlay, legend and callout.
6. **Hosting:** sign in, budget. UI: sign in, the monthly-limit states.
7. Projects, first run and build steps can land any time after phase 2.
