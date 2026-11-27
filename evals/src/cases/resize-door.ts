import { assemblyCount, bottomPlatePieces, calledTool, didNotCall, hasOpening, headerOverOpening, noPlan, sameWalls, soundBuild } from '../checks.ts';
import { defineScenario, undoSteps } from '../scenario.ts';
import { POOL_HOUSE_WITH_DOOR } from '../seeds.ts';
import { buildInOneTurn, expectSoundStep } from './common.ts';

const WALLS = ['W1', 'W2', 'W3', 'W4'];

/** Editing a framed opening in place (LOC-118): resize it, then take it out, never rebuilding the wall. */
export const resizeDoor = defineScenario({
  name: 'resize-door',
  description: 'Make the door 3ft wide with update_opening (walls keep their ids), then remove it with remove_opening',
  seed: POOL_HOUSE_WITH_DOOR,
  typical: true,
  async run(ctx) {
    // Plans are opt-in (ADR-0002 §F1) and this scenario leaves them off: both edits happen straight away.
    const t1 = await buildInOneTurn(ctx, 'Make the door 3 feet wide');
    const p1 = ctx.session.bus.project;
    ctx.expect(calledTool(t1, 'update_opening'));
    ctx.expect(didNotCall(t1, 'build_wall'));
    ctx.expect(didNotCall(t1, 'delete_assembly'));
    expectSoundStep(ctx, t1);
    ctx.expect(sameWalls(p1, WALLS));
    const { fail, opening } = hasOpening(p1, { kind: 'door', wall: 'south', widthIn: 36 });
    ctx.expect(fail);
    if (opening) ctx.expect(opening.asmId === 'O1' ? null : `the door should still be O1 (got ${opening.asmId})`);
    ctx.expect(headerOverOpening(p1, opening));

    const t2 = await ctx.turn('Actually, remove that door');
    const p2 = ctx.session.bus.project;
    ctx.expect(noPlan(t2, 'turn 2'));
    ctx.expect(calledTool(t2, 'remove_opening'));
    ctx.expect(didNotCall(t2, 'build_wall'));
    ctx.expect(assemblyCount(p2, 'opening', 0, 'openings'));
    ctx.expect(sameWalls(p2, WALLS));
    ctx.expect(bottomPlatePieces(p2, 'W3') === 1 ? null : `W3's bottom plate should be one piece again (got ${bottomPlatePieces(p2, 'W3')})`);
    ctx.expect(soundBuild(p2, ctx.session.catalog));
    const steps = undoSteps(ctx.session) - ctx.baseline.historyLength;
    ctx.expect(steps === 2 ? null : `the two turns should add two undo steps (got ${steps})`);
  },
});
