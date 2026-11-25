import { poolFence } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_IN_YARD } from '../seeds.ts';
import { expectSoundStep, planThenBuild } from './common.ts';

/** Acceptance (LOC-117): a pool barrier fence with a gate on the house side. */
export const poolFenceScenario = defineScenario({
  name: 'pool-fence',
  description: 'Pool fence around a seeded pool with a gate on the house side: ≥ 4ft, self-closing hinges, magnetic latch ≥ 54in, encloses the pool',
  seed: POOL_IN_YARD,
  fullBuild: true,
  async run(ctx) {
    const t2 = await planThenBuild(ctx, 'Put a pool fence around the pool with a gate on the house side');
    expectSoundStep(ctx, t2);
    ctx.expect(poolFence(ctx.session.bus.project));
  },
});
