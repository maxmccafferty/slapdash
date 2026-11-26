import { IN, nothingChanged, offeredOptions, openings, textMentions } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_HOUSE_WALLS } from '../seeds.ts';

/** A 20ft opening is past any built-up 2x header: Claude says why, changes nothing and offers alternatives. */
export const refuseImpossibleSpan = defineScenario({
  name: 'refuse-impossible-span',
  description: 'A 20ft garage-door opening is refused in plain language, with alternatives and no change',
  seed: POOL_HOUSE_WALLS,
  async run(ctx) {
    const t = await ctx.turn('Cut a 20ft-wide opening in the south wall for a garage door');
    const p = ctx.session.bus.project;
    const wide = openings(p).filter((o) => o.roWidth >= 20 * 12 * IN - IN);
    ctx.expect(wide.length === 0 ? null : `no 20ft opening should exist (got ${wide.map((o) => o.asmId).join(', ')})`);
    ctx.expect(nothingChanged(ctx.session, ctx.baseline));
    ctx.expect(offeredOptions(t, 2));
    ctx.expect(textMentions(t, /header|beam|narrower|engineer/i, 'why (the header/beam limit)'));
    // Not a check: Claude may know the limit without trying the tool first.
    ctx.log(`    (tool refusals this turn: ${t.refusals})`);
  },
});
