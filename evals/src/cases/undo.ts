import { assemblyCount, calledTool, hasOpening, noPlan, oneUndoStep, soundBuild } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { POOL_HOUSE_WALLS } from '../seeds.ts';

/** A small change with no plan, then "undo that" puts the model back exactly. */
export const undo = defineScenario({
  name: 'undo',
  description: 'Add a window (no plan), then "undo that" restores the walls exactly',
  seed: POOL_HOUSE_WALLS,
  typical: true,
  async run(ctx) {
    const t1 = await ctx.turn('Add a 3ft window to the east wall, centred');
    const p1 = ctx.session.bus.project;
    ctx.expect(noPlan(t1, 'turn 1'));
    ctx.expect(oneUndoStep(ctx.session, ctx.baseline, t1));
    ctx.expect(hasOpening(p1, { kind: 'window', wall: 'east', widthIn: 36 }).fail);
    ctx.expect(soundBuild(p1, ctx.session.catalog));

    const t2 = await ctx.turn('Actually, undo that');
    const p2 = ctx.session.bus.project;
    ctx.expect(calledTool(t2, 'undo'));
    const ids = Object.keys(p2.parts);
    const same = ids.length === ctx.baseline.partIds.size && ids.every((id) => ctx.baseline.partIds.has(id));
    ctx.expect(same ? null : `after undo the parts should match the walls before turn 1 (${ids.length} vs ${ctx.baseline.partIds.size})`);
    ctx.expect(assemblyCount(p2, 'opening', 0, 'openings after undo'));
    ctx.expect(ctx.session.bus.canRedo ? null : 'the window should be redoable after undo');
  },
});
