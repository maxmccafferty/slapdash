/**
 * The Claude request the keyhole sends, and the transport that sends it. The client only
 * supplies `messages`; everything else is fixed here on the server.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { SYSTEM_PROMPT, agentTools } from '@slapdash/agent';
import type { KeyholeConfig } from './config.ts';

/** Refusal fallback: on a policy decline the API re-runs the turn on a fallback model it picks. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type ClaudeParams = BetaMessageStreamParams;

/** Streams one Claude response. Swapped for a fake in tests. */
export type ClaudeTransport = (params: ClaudeParams, signal: AbortSignal) => AsyncIterable<BetaRawMessageStreamEvent>;

/**
 * The full request. Tools render before system, so the one `cache_control` on the system
 * block caches both; the top-level `cache_control` caches the growing conversation too.
 * `thinking` is left out so the model runs adaptive thinking.
 */
export function buildClaudeParams(
  config: Pick<KeyholeConfig, 'model' | 'maxTokens' | 'effort' | 'fallbacks'>,
  messages: BetaMessageParam[],
): ClaudeParams {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: agentTools() as unknown as BetaToolUnion[],
    cache_control: { type: 'ephemeral' },
    output_config: { effort: config.effort },
    messages,
    ...(config.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  };
}

/** The real transport: the official SDK's beta message stream. */
export function anthropicTransport(apiKey: string): ClaudeTransport {
  const client = new Anthropic({ apiKey });
  return (params, signal) => client.beta.messages.stream(params, { signal });
}
