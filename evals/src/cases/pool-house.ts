import { assemblyCount, commonStudLength, slabFootprint } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep, planThenBuild } from './common.ts';

/** LOC-108 acceptance 2: plan first, then a slab and four 9ft walls, 16×20, as one undo step. */
export const poolHouse = defineScenario({
  name: 'pool-house',
  description: 'Plan, then build a 16×20 slab and four 9ft walls as one undo step',
  fullBuild: true,
  async run(ctx) {
    const t2 = await planThenBuild(ctx, 'Build a 16×20 pool house on a slab with 9ft walls');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t2);
    ctx.expect(slabFootprint(p, 16, 20));
    ctx.expect(assemblyCount(p, 'wall', 4, 'walls'));
    ctx.expect(commonStudLength(p, 103.5));
  },
});
