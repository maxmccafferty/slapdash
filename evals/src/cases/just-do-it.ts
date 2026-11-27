import { assemblyCount, calledTool, commonStudLength, noPlan, slabFootprint } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep } from './common.ts';

/** With plans on (the person opted in earlier), "don't ask me first" turns the check off and builds straight away. */
export const justDoIt = defineScenario({
  name: 'just-do-it',
  description: 'With plans on, "Just do it" turns them off and builds a 10×12 shed shell in one step',
  prefs: { confirmBigChanges: true },
  fullBuild: true,
  async run(ctx) {
    const t = await ctx.turn("Just do it, don't ask me first: build a 10×12 shed on a slab with 8ft walls");
    const p = ctx.session.bus.project;
    ctx.expect(noPlan(t));
    ctx.expect(calledTool(t, 'set_preferences'));
    ctx.expect(ctx.session.memory.prefs.confirmBigChanges === false ? null : 'the big-change check should be off afterwards');
    expectSoundStep(ctx, t);
    ctx.expect(slabFootprint(p, 10, 12));
    ctx.expect(assemblyCount(p, 'wall', 4, 'walls'));
    // 8ft walls: 96in less a bottom and two top plates (3 × 1 1/2in).
    ctx.expect(commonStudLength(p, 91.5));
  },
});
