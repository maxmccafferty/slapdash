import { pergolaPolycarbonate } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep, buildInOneTurn } from './common.ts';

/** Acceptance (LOC-117): a 12×16 pergola with clear polycarbonate roofing. */
export const pergolaPolycarbonateScenario = defineScenario({
  name: 'pergola-polycarbonate',
  description: '12×16 pergola with clear polycarbonate roofing: posts on piers, a roof of polycarbonate panels at ≥ 1 in 12',
  fullBuild: true,
  async run(ctx) {
    const t2 = await buildInOneTurn(ctx, 'Build a 12×16 pergola with clear polycarbonate roofing, starting at the origin');
    expectSoundStep(ctx, t2);
    ctx.expect(pergolaPolycarbonate(ctx.session.bus.project));
  },
});
