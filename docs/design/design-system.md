# Slapdash

A 3D building planner you talk to. You say what you want built, Claude lays out every stud, joist and rafter, and you look around the model as it goes. This system is the look of the app on laptop, iPad and phone.

The design is monochrome Braun: a plain white world, grey control units like the housing of a Braun radio, black type, and one colour that means something. Geist is the only typeface.

## Principles

- **The model is the only colour.** Wood is wood (`wood`), concrete is concrete (`concrete`). Everything around it is white, grey and black, so the building is what you see first.
- **Orange means one thing.** `signal` marks what's selected or what Claude is working on right now: the dot on a chosen option, the floor slider knob, rafters being added, the Talk key. It is never decoration and never body text on white.
- **Controls live in units.** Anything you can press sits in a grey `unit` housing (`radius-unit` or `radius-panel`), with white keys inside it. Units float over the model with a `space-4` inset from the screen edge.
- **Every control is a title and its options.** A small `label` title sits over each two-way choice (View: 3D / 2D, Look from: Outside / Inside, Dimensions: On / Off, Stress: On / Off). Each is its own unit, so it never reads as one four-way switch.
- **Editing happens by talking.** There are no edit buttons on the model or in lists. Where something is missing, say so in grey (`no price yet`) and let Claude fill it in.
- **Quiet chrome, loud content.** Remove a control before adding one. If a panel needs a paragraph of explanation, the panel is wrong.

## The world

- White (`paper`) ground. The build area is a bounded floor (`floor`) drawn as a dot grid in `dot`, with a thin edge.
- Site context (the existing house, trees, the pool) is drawn as stippled dots in `dot` and slightly darker greys, never solid.
- A compass is drawn on the floor near its front corner: a dotted ring flat on the ground, a solid `ink` arrow to north with a bold N, and E, S, W in `muted`. It turns with the model, so walls can be named by direction ("the south wall").
- Measurements are hairline dimension lines with small white labels, written as builders do: `16′ 0″`, `9′ 0″`, `6 in 12`.
- 2D is a drawing sheet on a dot grid: the plan in the middle, North above, South below, West and East either side. Drag to move it; scroll to zoom.

## Layout

**Desktop (1440 × 900).** Model on the left, chat on the right in a `radius-sheet` unit 408px wide, inset `space-4`.
- Top left: the stud wall mark and wordmark, then units for Save / Load, Undo / Redo, Materials / Steps.
- Under it: the project name (`title-xl`) with four ruled specs (footprint, walls, roof, parts) in `spec`.
- Top right of the model: the floors unit, a vertical slider with an orange knob.
- Bottom left: the four view controls, one unit each.
- Materials, Projects and Build steps open as modals over the model only. The chat stays usable beside them.
- Materials has two tabs, Materials and Cut list, in a two-option track beside the title. One Export PDF covers both: drawings on page 1, materials on page 2, the cut list on page 3.

**Phone (390 × 844).** All corner buttons are icon-only, 40px keys in a unit.
- Top left: the project name and specs.
- Top right: one vertical unit with project (save, load, undo, redo), materials, build steps and a stack icon for floors.
- Bottom left: an eye icon for the view controls.
- Bottom right: the orange chat key, which opens the chat as a sheet.

## Voice

- Plain verbs, sentence case: "Build it", "Change something", "Next step", "Open the sample pool house".
- Claude talks like a builder friend: says what it did, in numbers, without hedging. "Walls are up. Door and window tops line up at 6′ 10″."
- Before a big change (a new structure, a roof, about 50 parts or more), Claude shows a short plan with **Build it** and **Change something**. Small changes just happen, with Undo beside them.
- When something can't be done, Claude says why in one sentence, offers two ways that work, and says "Nothing has changed yet."
- Costs are always ranges (`$1,470 – $2,030`), marked as an estimate. A price you give Claude replaces the table and gets the orange dot.

## Components

- **Key**: white key inside a unit. Pressed (latched) uses `shadow-pressed` and an orange dot.
- **View control**: title over a two-option track. The chosen option is a raised white piece (`shadow-raised`) with an orange dot.
- **Talk button**: the orange key that sits beside the text field, the same 44px height. Held, it darkens to `signal-pressed` and the field shows "Listening".
- **Control unit**: the grey housing all of the above sit in.
- **Material swatch**: the small round texture dot at the start of each materials row.

## Logo

The mark is a **stud wall**: three thick black studs under an orange top plate, the first thing Claude frames. It is slightly taller than wide; the top plate sits flush with the outer studs and is the only orange.

- On white: black studs, orange plate (`slapdash-mark.svg`).
- App icon: white studs and orange plate on a black rounded square (`slapdash-icon.svg`); the alternate is black studs and a white plate on orange (`slapdash-icon-orange.svg`).
- Lockup: the mark at the cap height of the wordmark, then `slapdash` in Geist 700, lowercase, letter-spacing −0.03em.
- Never recolour the studs orange, add a bottom plate, or set the mark inside another shape.

## Iconography

Outline icons, 1.3px stroke at 13px inside keys and 1.5px at 20px on the phone, in `ink`. Round joins. No filled icons, no emoji.

## Motion

Only motion that answers you: the floor knob slides (200ms), the chosen-option piece snaps across (180ms with a small overshoot), new parts drop into place as Claude adds them. Respect reduced motion.
