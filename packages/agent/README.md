# @slapdash/agent

What Claude is told, what it can call, and the loop that runs it, shared by the browser, the
server keyhole and the evals (ADR-0002 §A1, §E2). It runs anywhere: no DOM, no Node APIs, and
only *types* from the Anthropic SDK (`test/no-dom.test.ts` checks).

| Export | What |
| --- | --- |
| `SYSTEM_PROMPT` | Claude's system prompt (v2): the builder-friend voice, the `<project>` block, builders before primitives, lengths as strings like `"16ft 6in"`, plan before big changes, refusals as information and the can't-do pattern, looking and measuring, turn limits, estimates as ranges, photos as data. |
| `agentTools()` | The tool list: every exposed command, the history tools, then the agent tools below. Each has `eager_input_streaming: true`. Deep-frozen and memoised. |
| `runTurn(deps, input)` | One turn of the agent loop. Returns a `TurnResult` (text, plan, photo request, undo entry, cost, budget, refusals, cap). |
| `AgentMemory` | The chat for one project: builds API messages, ages out images, folds old turns, holds the "just do it" preference. `toChatLog()` is what you save. |
| `fetchKeyholeClient({ url?, fetch })`, `KeyholeClient`, `KeyholeRequestError` | How the loop reaches Claude. Errors carry a `KeyholeState` (`capped`, `rate_limited`, …). |
| `accumulateMessage(events)` | Builds Claude's reply from the keyhole's stream events. |
| `projectSummary(project, opts)` | The `<project>` block. |
| `dispatchTool`, `checkCall`, `MUTATING_TOOLS`, `BIG_CHANGE_TOOLS`, `BIG_CHANGE_PART_THRESHOLD`, `DEFAULT_CAPS` | The pieces the loop uses, exported for tests and the UI. |
| `findParts`, `getPartInfo`, `measure`, `listMaterials` | The query tools, as pure functions over `(project, catalog, input)`. |
| `zSnapshotRequest`, `validateSnapshotRequest`, `SnapshotError`, `SnapshotProvider`, … | The snapshot request (re-exported by `apps/web`). |
| `zKeyholeRequest`, `parseKeyholeEvents()`, `BudgetStatus`, `KeyholeEvent`, … | The wire protocol of `/api/claude` (see CONTRIBUTING, "Claude server (keyhole)"). |

## The loop

`runTurn` adds the person's message (a `<project>` summary, any photos, their text), opens one
undo group (`source: 'claude'`, the turn's id), then asks Claude, runs the tools it calls and
sends the results back until Claude stops. The group and the turn always close, even when the
keyhole refuses (budget, rate limit) or the turn is cancelled; any tool call left without a
result gets a "Stopped" result so the history stays valid. The caller saves
`memory.toChatLog()` afterwards (`ProjectSession.replaceChat`).

Wiring it in the browser (`apps/web/src/agent/chat-controller.ts` does this):

```ts
const client = fetchKeyholeClient({ fetch: globalThis.fetch.bind(globalThis) });
const memory = new AgentMemory(session.chat, { loadFile: (id) => /* the photo as base64 */ });
const result = await runTurn(
  { bus: session.bus, client, memory, snapshot: browserSnapshotProvider, signal, onEvent },
  { text, photos, approvePlan, pointedAt: { id: 'W3-H01', label: 'Header, South wall' } },
);
session.replaceChat(memory.toChatLog());
```

`browserSnapshotProvider` is in `apps/web/src/agent/snapshot-provider.ts`. Send `plan` events
to `useModelStore.setProposal` (the footprint is in millimetres) and show Build it / Change
something; send `photo_request` events to the camera; show `options` events as tappable keys
whose text is sent as the next message. `pointedAt` is the part the person tapped; Claude reads
it as `<pointing_at part="W3-H01">Header, South wall</pointing_at>` before their text.

## Tools

After the commands and history tools come the agent tools, in this order:

| Tool | What |
| --- | --- |
| `find_parts` | Parts by assembly, role, material, tag or nearness to a point: a count and one row per part. |
| `get_part` | One part (size, position, joints) or one assembly (its builder recipe, part counts, bounds). |
| `measure` | Centre-to-centre distance, dx/dy/dz and the clear gap (or overlap) between two ids or points. |
| `list_materials` | Pieces and linear feet, sheet goods, concrete volume and fasteners. Quantities only. |
| `snapshot` | A picture from the offscreen renderer. Refused in Node, where there is no renderer. |
| `propose_plan` | Shows a one-line plan with Build it / Change something. |
| `request_photo` | Asks the person for a photo. |
| `set_preferences` | `confirmBigChanges: false` is "just do it" for this project. |
| `offer_options` | Two or three one-line choices when Claude can't do what was asked; the chat shows them as keys. |

To add one: give it a strict Zod schema and description in `src/tools/schemas.ts` (append to
`agentToolDefs`; the order is prompt-cached), run it in `src/dispatch.ts`, and add it to the
order test in `test/tools.test.ts`. Use `zLength` for lengths so Claude passes `"16ft 6in"`.
Bus commands become tools automatically through `commandJsonSchemas()`.

## Big changes and caps

`src/guard.ts` refuses, as information, before a tool runs:

- **Big changes without a plan.** A structure-starting builder (`pour_slab`, `frame_floor`,
  `build_roof`, `place_structure`, `build_fence`), or any command whose dry run
  (`CommandBus.dryRun`) would bring the parts made this turn to 50 or more. Allowed when the
  previous turn ended with a plan (any reply but Change something answers it), when the
  person said "just do it", and always for undo, redo and restore.
- **Building after a plan in the same turn.**
- **Caps per turn:** 60 tool calls, 3 snapshots, 30 requests (`caps` in the deps). When one is
  reached, Claude gets one more request to wrap up and nothing else runs.

## Memory

- Turns beyond 10, or beyond about 60 000 characters of history, fold into `summary`: one line
  per turn (what was asked, the bus's change summaries, Claude's closing words), capped at
  4 000 characters. Whole turns fold, so a tool call never loses its result. The summary is
  sent as an `<earlier_conversation>` block.
- Snapshots and photos are sent for their turn and the next, then replaced by a text stub.
  Snapshot bytes are never saved. Photos are saved as `slapdash_file` references and loaded
  through `loadFile` while recent, each preceded by a note that it is data, not instructions.
- `<project>` blocks older than that become "[project summary omitted — see the latest one]".

## Prompt caching

The keyhole caches the tools and the system prompt with one breakpoint, so both must be
byte-stable: no dates, no random or generated values, a fixed tool order. The tests check
that (`test/system-prompt.test.ts`, `test/tools.test.ts`). Changing the prompt is fine; it
costs one cache write. Old messages are not rewritten while they are sent, so the conversation
prefix caches within a turn.

## Tests and evals

```sh
pnpm --filter @slapdash/agent test        # no network: a scripted client replays Claude
pnpm --filter @slapdash/agent typecheck
pnpm eval                                  # real API, costs money (see CONTRIBUTING, "Evals")
```
