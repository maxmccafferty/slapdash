import { assemblyCount, commonStudLength, headerOverOpening, hasOpening, slabFootprint } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep, planThenBuild } from './common.ts';

/** The ADR-0002 §D10 prompt: the pool house plus a framed sliding door on the south wall. */
export const poolHouseSlidingDoor = defineScenario({
  name: 'pool-house-sliding-door',
  description: 'Pool house with a sliding door on the south side: opening, header, sound framing',
  async run(ctx) {
    const t2 = await planThenBuild(ctx, '16×20 pool house on a slab, 9ft walls, sliding door on the south side');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t2);
    ctx.expect(slabFootprint(p, 16, 20));
    ctx.expect(assemblyCount(p, 'wall', 4, 'walls'));
    ctx.expect(commonStudLength(p, 103.5));
    ctx.expect(assemblyCount(p, 'opening', 1, 'opening'));
    const { fail, opening } = hasOpening(p, { kind: 'sliding-door', wall: 'south', minWidthIn: 72 });
    ctx.expect(fail);
    ctx.expect(headerOverOpening(p, opening));
  },
});
