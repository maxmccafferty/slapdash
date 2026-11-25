import { agentTools, SYSTEM_PROMPT } from '@slapdash/agent';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it } from 'vitest';
import { buildClaudeParams, FALLBACK_BETA, readConfig } from '../src/index.ts';

const MESSAGES: BetaMessageParam[] = [
  { role: 'user', content: 'Build a 10x12 shed' },
  { role: 'assistant', content: [{ type: 'text', text: 'Go?' }] },
  { role: 'user', content: [{ type: 'text', text: 'Yes' }] },
];

describe('buildClaudeParams', () => {
  const params = buildClaudeParams(readConfig({}), MESSAGES);

  it('uses the configured model, max tokens and effort', () => {
    expect(params.model).toBe('claude-sonnet-5-5');
    expect(params.max_tokens).toBe(32000);
    expect(params.output_config).toEqual({ effort: 'medium' });
    const custom = buildClaudeParams(readConfig({ SLAPDASH_MODEL: 'claude-opus-5-5', SLAPDASH_EFFORT: 'high' }), MESSAGES);
    expect(custom.model).toBe('claude-opus-5-5');
    expect(custom.output_config).toEqual({ effort: 'high' });
  });

  it('caches the system prompt block and the conversation', () => {
    expect(params.system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends the agent tools unchanged', () => {
    expect(params.tools).toEqual(agentTools());
    expect(JSON.stringify(params.tools)).toBe(JSON.stringify(buildClaudeParams(readConfig({}), []).tools));
  });

  it('turns on the refusal fallback by default and leaves it out when off', () => {
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(params.fallbacks).toBe('default');
    const off = buildClaudeParams(readConfig({ SLAPDASH_FALLBACKS: 'off' }), MESSAGES);
    expect(off).not.toHaveProperty('betas');
    expect(off).not.toHaveProperty('fallbacks');
  });

  it('passes messages through unchanged', () => {
    expect(params.messages).toBe(MESSAGES);
  });

  it('sends no thinking, sampling or tool_choice settings', () => {
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice', 'stream']) expect(params).not.toHaveProperty(key);
  });
});
