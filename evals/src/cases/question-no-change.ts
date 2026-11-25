import { noMutatingCalls, noPlan, nothingChanged, textMentions } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_HOUSE_WALLS } from '../seeds.ts';

/** A question changes nothing: the typical cheap turn for the cost estimate. */
export const questionNoChange = defineScenario({
  name: 'question-no-change',
  description: 'A question about the walls and slab is answered without changing anything',
  seed: POOL_HOUSE_WALLS,
  typical: true,
  async run(ctx) {
    const t = await ctx.turn('How tall are the walls and how big is the slab?');
    ctx.expect(nothingChanged(ctx.session, ctx.baseline));
    ctx.expect(noPlan(t));
    ctx.expect(noMutatingCalls(t));
    ctx.expect(textMentions(t, /9\s*(ft|foot|feet|')/i, 'the 9ft wall height'));
  },
});
