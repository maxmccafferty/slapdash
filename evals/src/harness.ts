/**
 * Runs the agent loop in plain Node: the keyhole handler is called in-process through a
 * `fetch` shim, so no browser and no server are needed. It uses the same config, budget and
 * usage file as `pnpm dev`, so eval spend counts towards the month's cap.
 */
import { fileURLToPath } from 'node:url';
import { AgentMemory, fetchKeyholeClient, runTurn, type AgentEvent, type KeyholeClient, type TurnResult, type UserInput } from '@slapdash/agent';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, type Project } from '@slapdash/core';
import { createKeyholeFromEnv, type Env } from '@slapdash/keyhole';

const REPO_USAGE_FILE = fileURLToPath(new URL('../../.data/usage.json', import.meta.url));

/** A keyhole client whose requests go straight to an in-process keyhole handler. */
export function inProcessKeyhole(env: Env): KeyholeClient {
  const handler = createKeyholeFromEnv({ SLAPDASH_USAGE_FILE: REPO_USAGE_FILE, ...env });
  return fetchKeyholeClient({
    url: 'http://localhost/api/claude',
    fetch: (url, init) => handler(new Request(url, init)),
  });
}

export interface EvalSession {
  bus: CommandBus;
  memory: AgentMemory;
  /** One turn; logs tool calls and returns the result. */
  turn(input: UserInput | string): Promise<TurnResult>;
}

export function evalSession(client: KeyholeClient, opts: { project?: Project; log?: (line: string) => void } = {}): EvalSession {
  const bus = new CommandBus({ project: opts.project ?? createProject({ name: 'Eval' }), catalog: TIER1_CATALOG });
  const memory = new AgentMemory();
  const log = opts.log ?? (() => {});
  let n = 0;
  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool_start') log(`    → ${e.name} ${JSON.stringify(e.input).slice(0, 160)}`);
    if (e.type === 'tool_result' && e.isError) log(`      ✗ ${typeof e.content === 'string' ? e.content.slice(0, 200) : '(blocks)'}`);
  };
  return {
    bus,
    memory,
    turn: (input) =>
      runTurn({ bus, memory, client, onEvent, newTurnId: () => `eval-${++n}` }, typeof input === 'string' ? { text: input } : input),
  };
}
