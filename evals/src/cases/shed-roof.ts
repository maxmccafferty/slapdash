import { assembliesOf, partsIn } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { SHED_WALLS_8x10 } from '../seeds.ts';
import { expectSoundStep, buildInOneTurn } from './common.ts';

/** A 3 in 12 shed roof on seeded 10×8 walls, low side north, bearing on the plates. */
export const shedRoof = defineScenario({
  name: 'shed-roof',
  description: '3 in 12 shed roof sloping north on existing shed walls: rafters bear on the plates',
  seed: SHED_WALLS_8x10,
  async run(ctx) {
    const t2 = await buildInOneTurn(ctx, 'Put a shed roof on it, 3 in 12, sloping down to the north');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t2);
    const roofs = assembliesOf(p, 'roof');
    ctx.expect(roofs.length === 1 ? null : `one roof (got ${roofs.length})`);
    const roof = roofs[0];
    if (!roof) return;
    const params = (roof.builder?.params ?? {}) as { type?: string; lowSide?: string; pitchRise?: number };
    ctx.expect(params.type === 'shed' ? null : `a shed roof (got ${params.type ?? 'none'})`);
    ctx.expect(params.lowSide === 'north' ? null : `low side north (got ${params.lowSide ?? 'none'})`);
    ctx.expect(params.pitchRise !== undefined && Math.abs(params.pitchRise - 3) < 0.05 ? null : `pitch 3 in 12 (got ${params.pitchRise ?? '?'} in 12)`);
    const rafters = partsIn(p, roof.id).filter((x) => x.role === 'rafter');
    ctx.expect(rafters.length > 0 ? null : 'the roof should have rafters');
    const ids = new Set(rafters.map((r) => r.id));
    const bearing = Object.values(p.joints).filter((j) => j.partIds.some((id) => ids.has(id)) && j.partIds.some((id) => p.parts[id]?.role === 'plate'));
    ctx.expect(bearing.length > 0 ? null : 'the rafters should be joined to the wall plates');
  },
});
