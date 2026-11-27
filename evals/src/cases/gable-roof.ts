import { assembliesOf, rafterCuts, rafterFlushAtRidge, boundsOf, partsIn } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_HOUSE_WALLS } from '../seeds.ts';
import { expectSoundStep, buildInOneTurn } from './common.ts';

/** A 6 in 12 gable on the seeded 20×16 walls: ridge along the long (east-west) side. */
export const gableRoof = defineScenario({
  name: 'gable-roof',
  description: '6 in 12 gable roof on existing pool-house walls: ridge along x, rafters in pairs',
  seed: POOL_HOUSE_WALLS,
  async run(ctx) {
    const t2 = await buildInOneTurn(ctx, 'Add a 6 in 12 gable roof');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t2);
    const roofs = assembliesOf(p, 'roof');
    ctx.expect(roofs.length === 1 ? null : `one roof (got ${roofs.length})`);
    const roof = roofs[0];
    if (!roof) return;
    const params = (roof.builder?.params ?? {}) as { type?: string; pitchRise?: number };
    ctx.expect(params.type === 'gable' ? null : `a gable roof (got ${params.type ?? 'none'})`);
    ctx.expect(params.pitchRise !== undefined && Math.abs(params.pitchRise - 6) < 0.05 ? null : `pitch 6 in 12 (got ${params.pitchRise ?? '?'} in 12)`);
    const parts = partsIn(p, roof.id);
    const ridge = parts.find((x) => x.role === 'ridge');
    ctx.expect(ridge ? null : 'the roof should have a ridge');
    if (ridge) {
      const b = boundsOf([ridge])!;
      ctx.expect(b.max.x - b.min.x > b.max.z - b.min.z ? null : 'the ridge should run east-west, along the longer side');
    }
    const rafters = parts.filter((x) => x.role === 'rafter' && x.tags.includes('common')).length;
    ctx.expect(rafters > 0 && rafters % 2 === 0 ? null : `common rafters should come in pairs (got ${rafters})`);
    ctx.expect(rafterCuts(p, roof.id, 6));
    ctx.expect(rafterFlushAtRidge(p, roof.id));
  },
});
