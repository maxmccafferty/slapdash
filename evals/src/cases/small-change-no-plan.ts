import { distanceFromWallEnd, fi, FT, headerOverOpening, hasOpening, noPlan, STANDARD_DOOR } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_HOUSE_WALLS } from '../seeds.ts';
import { expectSoundStep } from './common.ts';

/** A door is a small change: built straight away, one undo step, where it was asked for, even with plans on. */
export const smallChangeNoPlan = defineScenario({
  name: 'small-change-no-plan',
  description: 'With plans on, add a door 4ft from the north corner of the west wall without a plan',
  seed: POOL_HOUSE_WALLS,
  prefs: { confirmBigChanges: true },
  typical: true,
  async run(ctx) {
    const t = await ctx.turn('Add a door to the west wall, 4ft from the north corner');
    const p = ctx.session.bus.project;
    ctx.expect(noPlan(t));
    expectSoundStep(ctx, t);
    // The prompt gives no width, so any standard exterior door (2' 8" to 3' 2") will do.
    const { fail, opening } = hasOpening(p, { kind: 'door', wall: 'west', ...STANDARD_DOOR });
    ctx.expect(fail);
    ctx.expect(headerOverOpening(p, opening));
    if (opening) {
      // "4ft from the corner" may mean to the near edge (centre ≈ 5' 7") or to the centre (4' 0"); allow both, ±1ft.
      const d = distanceFromWallEnd(p, opening, 'north');
      const toEdge = 4 * FT + opening.roWidth / 2;
      const ok = Math.abs(d - 4 * FT) <= FT || Math.abs(d - toEdge) <= FT;
      ctx.expect(ok ? null : `the door should be about 4ft from the north corner (its centre is ${fi(d)} away)`);
    }
  },
});
