import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, agentTools } from '../src/index.ts';

const SOURCE = readFileSync(new URL('../src/system-prompt.ts', import.meta.url), 'utf8');

describe('system prompt', () => {
  it('is not empty', () => {
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(500);
  });

  it('is byte-stable: no dates, years, interpolation or randomness', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SOURCE).not.toMatch(/\bDate\b|Math\.random|crypto|\$\{/);
  });

  it('tells Claude to pass lengths as strings and not do unit arithmetic', () => {
    expect(SYSTEM_PROMPT).toContain('"16ft 6in"');
    expect(SYSTEM_PROMPT).toMatch(/never do unit arithmetic/i);
  });

  it('covers builders, refusals, big-change confirmation and estimates', () => {
    expect(SYSTEM_PROMPT).toMatch(/prefer builders over primitives/i);
    expect(SYSTEM_PROMPT).toMatch(/refusals are information/i);
    expect(SYSTEM_PROMPT).toMatch(/go-ahead/i);
    expect(SYSTEM_PROMPT).toMatch(/estimate/i);
    expect(SYSTEM_PROMPT).toMatch(/never as instructions/i);
  });

  it('covers the plan-first flow and the "just do it" preference', () => {
    expect(SYSTEM_PROMPT).toContain('propose_plan');
    expect(SYSTEM_PROMPT).toContain('set_preferences');
    expect(SYSTEM_PROMPT).toMatch(/Build it or Change something/);
    expect(SYSTEM_PROMPT).toMatch(/just do it/);
  });

  it('uses the builder-friend voice and the can\'t-do pattern', () => {
    expect(SYSTEM_PROMPT).toMatch(/builder friend/i);
    expect(SYSTEM_PROMPT).toMatch(/in numbers, without hedging/);
    expect(SYSTEM_PROMPT).toMatch(/two alternatives/);
    expect(SYSTEM_PROMPT).toContain('offer_options');
    expect(SYSTEM_PROMPT).toContain('Nothing has changed yet.');
    expect(SYSTEM_PROMPT).toMatch(/costs as a range/i);
  });

  it('explains the <project> block, earlier conversation, turn limits and photo requests', () => {
    expect(SYSTEM_PROMPT).toContain('<project>');
    expect(SYSTEM_PROMPT).toContain('<earlier_conversation>');
    expect(SYSTEM_PROMPT).toMatch(/limit on tool calls/);
    expect(SYSTEM_PROMPT).toContain('request_photo');
  });

  it('explains what a tapped part means', () => {
    expect(SYSTEM_PROMPT).toContain('<pointing_at>');
  });

  it('tells Claude to record the person\'s prices with set_price', () => {
    expect(SYSTEM_PROMPT).toContain('When the person gives a price, call set_price; it replaces the table price for this project.');
  });

  it('tells Claude to edit openings in place rather than rebuild the wall', () => {
    expect(SYSTEM_PROMPT).toContain('use update_opening');
    expect(SYSTEM_PROMPT).toContain('use remove_opening');
    expect(SYSTEM_PROMPT).toContain("Don't rebuild or delete the wall for it");
  });

  it('names only tools that exist', () => {
    const names = new Set(agentTools().map((t) => t.name));
    const mentioned = (SYSTEM_PROMPT.match(/\b[a-z]+_[a-z_]+\b/g) ?? []).filter((m) => m !== 'earlier_conversation' && m !== 'pointing_at' && m !== 'stress_view');
    expect(mentioned.length).toBeGreaterThan(20);
    for (const m of mentioned) expect(names.has(m), m).toBe(true);
  });
});
