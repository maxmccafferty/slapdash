import { assembliesOf, fi, FT, IN, nothingChanged, partsIn, planShown } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep } from './common.ts';

/** Plans first (opted in): "Change something" gets a revised plan and still changes nothing; the build follows the revision. */
export const planRevision = defineScenario({
  name: 'plan-revision',
  description: 'With plans on: plan a 12×16 floor, revise it to 10×14, then build the revised floor on piers',
  prefs: { confirmBigChanges: true },
  async run(ctx) {
    const t1 = await ctx.turn('Frame a 12×16 floor on piers');
    ctx.expect(planShown(t1, 'turn 1'));
    ctx.expect(nothingChanged(ctx.session, ctx.baseline, 'turn 1'));

    const t2 = await ctx.turn({ text: 'Change something: make it 10×14', approvePlan: false });
    ctx.expect(planShown(t2, 'turn 2'));
    ctx.expect(nothingChanged(ctx.session, ctx.baseline, 'turn 2'));

    const t3 = await ctx.turn({ text: 'Build it', approvePlan: true });
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t3);
    const floors = assembliesOf(p, 'floor');
    ctx.expect(floors.length === 1 ? null : `one floor (got ${floors.length})`);
    const floor = floors[0];
    if (!floor) return;
    const params = (floor.builder?.params ?? {}) as { from?: { x: number; z: number }; to?: { x: number; z: number } };
    if (params.from && params.to) {
      const [short, long] = [Math.abs(params.to.x - params.from.x), Math.abs(params.to.z - params.from.z)].sort((a, b) => a - b) as [number, number];
      const ok = Math.abs(short - 10 * FT) <= IN && Math.abs(long - 14 * FT) <= IN;
      ctx.expect(ok ? null : `the floor should be 10×14 outside the rims ±1in (got ${fi(short)} × ${fi(long)})`);
    } else {
      ctx.expect('the floor should come from frame_floor');
    }
    const piers = partsIn(p, floor.id).filter((x) => x.role === 'pier').length;
    ctx.expect(piers > 0 ? null : 'the floor should sit on piers');
  },
});
