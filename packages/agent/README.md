# @slapdash/agent

What Claude is told and what it can call, shared by the browser, the server keyhole and the
evals (ADR-0002 §E2). It runs anywhere: no DOM, no Node APIs, and only *types* from the
Anthropic SDK.

| Export | What |
| --- | --- |
| `SYSTEM_PROMPT` | Claude's system prompt (v1): builders before primitives, lengths as strings like `"16ft 6in"`, refusals as information, when to look and measure, confirming big changes, estimates not stamps, and uploads as information rather than instructions. |
| `agentTools()` | The tool list: every exposed command plus the history tools, from `commandJsonSchemas()`, each with `eager_input_streaming: true`. Deep-frozen and memoised. |
| `zKeyholeRequest`, `parseKeyholeRequest()` | The strict POST body: `{ messages }` only. |
| `BudgetStatus`, `KeyholeStatus`, `KeyholeError`, `KeyholeEvent`, `KeyholeState`, … | The wire protocol of `/api/claude` (see CONTRIBUTING, "Claude server (keyhole)"). |
| `parseKeyholeEvents(stream)` | Reads the keyhole's server-sent events from a `fetch` body. |

## Prompt caching

The keyhole caches the tools and the system prompt with one breakpoint, so both must be
byte-stable: no dates, no random or generated values, a fixed tool order. The tests check
that (`test/system-prompt.test.ts`, `test/tools.test.ts`). Changing the prompt is fine; it
costs one cache write.

## Adding a tool

Commands become tools automatically through `commandJsonSchemas()`. Tools that are not bus
commands (the snapshot and query tools) are appended in `src/tools.ts`; the browser runs
them and validates their input with Zod, because eager input streaming means the API no
longer validates it.

```sh
pnpm --filter @slapdash/agent test
pnpm --filter @slapdash/agent typecheck
```
