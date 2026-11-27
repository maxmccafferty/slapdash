import { assemblyCount, commonStudLength, slabFootprint } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep, buildInOneTurn } from './common.ts';

/** LOC-108 acceptance 2: a slab and four 9ft walls, 16×20, built straight away as one undo step. */
export const poolHouse = defineScenario({
  name: 'pool-house',
  description: 'Build a 16×20 slab and four 9ft walls straight away (no plan) as one undo step',
  fullBuild: true,
  async run(ctx) {
    const t = await buildInOneTurn(ctx, 'Build a 16×20 pool house on a slab with 9ft walls');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t);
    ctx.expect(slabFootprint(p, 16, 20));
    ctx.expect(assemblyCount(p, 'wall', 4, 'walls'));
    ctx.expect(commonStudLength(p, 103.5));
  },
});
