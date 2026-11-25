# ADR-0003: App design — look, layout and controls

**Status:** Proposed
**Date:** 2026-11-24
**Builds on:** ADR-0001, ADR-0002

## Context

ADR-0001 and ADR-0002 set the architecture and the product decisions but left the look and the on-screen controls open. A design pass produced the screens for desktop and phone. This ADR records the decisions that pass made, including the places where it changes ADR-0002.

- Design canvas (all screens, Final and Explorations pages): https://claude.ai/artifact/KMhJpH5QmQypWD8EeuWtyv
- Design system (tokens, type, components): https://claude.ai/artifact/BAXuWhXRh2xGm8qFsC1X8b

## Decision

### A. Look

1. **Monochrome Braun.** A plain white world, grey control "units" like the housing of a Braun radio, black type, one typeface (Geist).
2. **The model is the only colour.** Lumber, concrete and steel get their own colours; nothing else on screen does.
3. **Orange means one thing.** `#E8590C` marks what is selected or what Claude is working on right now: the dot on a chosen option, the floor knob, parts being added, the Talk key. It is never used as decoration or as body text on white.
4. **The site is drawn, not modelled in detail.** The build area is a bounded floor shown as a dot grid. Site context (house, trees, pool) is stippled dots.
5. **Logo: a stud wall.** Three thick black studs under an orange top plate; white studs on black for the app icon. Files and rules are in the design system.

### B. Desktop layout (1440 × 900)

1. Model on the left. Chat on the right in a 408px panel that runs the full height, with the text field, a send key and an orange Talk key the same height as the field.
2. Top left: wordmark, then Save / Load, Undo / Redo, Materials / Steps, each pair in its own unit.
3. Under that, the project name and four specs: footprint, walls, roof, parts.
4. Top right of the model: the floor selector, a vertical slider with an orange knob.
5. Bottom left: the view controls (C). Zoom is scroll only, with a small percentage readout; there is no zoom control.

### C. View controls (changes ADR-0002 §C16)

The five view modes in ADR-0002 (textured, blueprint, x-ray, stress, exploded) are replaced in the UI by four independent two-way controls, each its own unit with a title:

| Control | Options | Notes |
| --- | --- | --- |
| View | 3D / 2D | 2D is a drawing sheet (D) |
| Look from | Outside / Inside | Inside cuts the walls at 4′ and removes the roof |
| Dimensions | On / Off | Hairline dimension lines in builder's units |
| Stress | On / Off | Load shading, light grey → orange; disabled in 2D |

Plus **Floors** (Roof / Floor 1 / Foundation), which hides everything above the chosen level.

Blueprint and x-ray are dropped from the UI: 2D covers blueprint, and Inside covers most of x-ray. The `snapshot` tool (ADR-0002 §B10) may still render those modes for Claude's own use.

### D. 2D drawing sheet

2D shows every angle at once on a dot-grid sheet: the plan (cut at 4′) in the middle, North above, South below, West and East either side, with dimensions and a north arrow. Drag to move, scroll to zoom. Generated from the same model as 3D.

### E. Build steps (replaces the exploded view, ADR-0001 §7)

The exploded view is not a view mode. Assembly is a **Build steps** screen: the steps in order (Slab, Walls, Roof for the pool house), each with a short how-to, Back / Next step, and the model showing the building up to that step. Opened from the Steps key.

### F. Materials

1. A modal over the model area only; the chat stays usable beside it.
2. Content: the total at the top, then a plain list grouped by part of the build (Slab, Walls, Roof), each group header carrying the Amount and Cost column labels, a texture swatch on each row, and a Total row at the bottom. Export PDF and close.
   - Two tabs: **Materials** (above) and **Cut list**. The cut list groups pieces by the board they are cut from (for example "From 2×4 precut studs, 104⅝″"), with each piece's length and count. One Export PDF covers both.
3. **No edit buttons.** Unpriced rows say "no price yet". Prices, quantities and changes are made by telling Claude; a price you give replaces the table for that project and is marked with the orange dot (ADR-0001 §11).

### G. Conversation

1. **Before a big change** (ADR-0002 §F1), Claude shows a short plan as a card with **Build it** and **Change something**, and the planned structure appears on the floor as an orange dashed outline. Small changes apply at once with an Undo beside the message.
2. **Talking:** while Talk is held the field shows a waveform and "Listening"; words appear in the transcript as they are heard.
3. **Pointing at a part** (resolves ADR-0002's open question on interactivity, in part): tap a part to highlight it in orange; it is attached to the next message as a chip ("Door header, south wall"). The 3D view stays view-only otherwise.
4. **When Claude can't do something,** it says why in one sentence, offers two ways that work as tappable options, and states that nothing has changed.

### H. Phone layout (390 × 844)

All corner buttons are icon-only, 40px keys inside units.

- Top left: the project name and specs, tight to the top edge.
- Top right: one vertical unit holding, top to bottom, project (Save, Load, Undo, Redo in a popover), materials, build steps, and a stack icon for the floor selector. Popovers open to the left of the unit. Build steps opens as a bottom sheet over the model.
- Bottom left: an eye icon opens the four view controls.
- Bottom right: the orange chat key opens the chat as a bottom sheet. The model slides up to stay visible.
- Materials is a near full-screen sheet with the chat key still floating over it.

### I. Projects and first run

1. **Load** opens a Projects modal: projects on this device as cards with a thumbnail, a New project card, and Import a .slapdash file.
2. **First run** is an empty site (dot floor, no model) titled "New project", with the chat asking "What are we building?" and three tappable starters, plus "Open the sample pool house".
3. **No API key:** the chat explains that Claude isn't connected, how to add `ANTHROPIC_API_KEY`, and offers the sample project; the text field and Talk key are disabled.

### K. Also designed

1. **Stress finds a weak spot.** With Stress on, the most loaded part gets a callout ("Door header, about 90% of its limit"); Claude explains in one or two sentences and offers a fix or leave it.
2. **Monthly limit** (ADR-0002 §D9). A note in the chat at 80% of the $10 budget; at the cap the chat explains when Claude is back and disables the input, while everything else keeps working.
3. **Sign in** (hosted copy). Email and password or a passkey on a plain card over the dotted floor; "You'll stay signed in on this device." No sign-up screen.
4. **Exported PDF.** Three letter-size sections, each starting on its own page so a long list can run on without disturbing the others. Page 1, drawings: name and specs, then the 2D sheet (plan and four elevations) with dimensions: footprint, wall and ridge heights, wall lengths, door and window openings, roof pitch. Page 2, materials: the list with totals. Page 3, cut list: grouped by board, with a tick box per piece.

### J. Left out on purpose

1. **No settings screen.** Location, design loads and the model are set in configuration (`.env` and the project defaults) and are not editable in the app.
2. **No visible version history.** Users manage their work with Save and Load only. Undo and the history tools in ADR-0002 §A8 stay available to Claude, but there is no history or named-versions screen (changes ADR-0002 §D7).
3. **No "something's off" report** (drops ADR-0002 §F4).
4. **Photos come in only when Claude asks.** There is no general upload or "look at this" button (changes ADR-0002 §B12). When Claude needs a photo (an existing wall, a sketch), it asks in the chat with a Take photo / Choose photo action; the photo is stored through `ProjectStore` as before.

### L. License

MIT (resolves the open question in ADR-0002). No AGPL code is to be copied in, per ADR-0002 §E6.

## Consequences

- The renderer needs: view-only 3D plus a level cut (Floors), a 4′ section cut (Inside), a stress overlay with a five-step grey-to-orange ramp, dimension lines, a highlight for a pointed-at part, and a generated 2D sheet (plan plus four elevations) from the same model.
- The 2D sheet is new scope relative to ADR-0002; it is drawn from the parts model, not from screenshots.
- Build steps needs each builder to tag its parts with a step, so the sequence comes from the model.
- Materials needs a texture swatch per catalog entry; the swatch can be generated from the entry's render colours.
- The cut list comes from the in-house cut-list optimizer (ADR-0002 §E7): every part's length is in the model, and the optimizer assigns parts to stock boards.
- Design tokens live in the design system artifact; the app's CSS variables should be generated from its `tokens.json` so the two never drift.
- ADR-0002 §C16's list of view modes and the mention of an exploded slider are superseded by §C and §E here.
