import { answered, assemblyCount, feetRe, hasOpening, noMutatingCalls, noPlan, nothingChanged, oneUndoStep, slabFootprint, soundBuild, textMentions } from '../checks.ts';
import { baselineOf, defineScenario } from '../scenario.ts';
import { expectSoundStep, planThenBuild } from './common.ts';

/**
 * Regression for LOC-108: after a turn in which Claude thought, every later message got HTTP 400
 * ("Invalid `signature` in `thinking` block"), because memory rewrote older turns and broke the
 * replayed thinking signatures. A full build (likely to think) is followed by a question and a
 * small edit; each must get a real reply and do what was asked. An upstream error on any turn
 * ends the scenario as an error.
 */
export const followUpsAfterBuild = defineScenario({
  name: 'follow-ups-after-build',
  description: 'Plan and build the pool house, then a question and a small edit both get real replies',
  async run(ctx) {
    const t2 = await planThenBuild(ctx, 'Build a 16×20 pool house on a slab with 9ft walls');
    const p2 = ctx.session.bus.project;
    ctx.expect(answered(t2, 'the build turn'));
    expectSoundStep(ctx, t2);
    ctx.expect(slabFootprint(p2, 16, 20));
    ctx.expect(assemblyCount(p2, 'wall', 4, 'walls'));
    // Not a failure: whether Claude thinks is up to the model. Without it this run doesn't exercise the bug.
    if (t2.record.thinking === 0) ctx.log('    note: no thinking in the build turn, so this run did not replay a thinking signature');

    const afterBuild = baselineOf(ctx.session);
    const t3 = await ctx.turn('How tall are the walls?');
    ctx.expect(answered(t3, 'the question turn'));
    ctx.expect(noPlan(t3, 'the question turn'));
    ctx.expect(noMutatingCalls(t3));
    ctx.expect(nothingChanged(ctx.session, afterBuild, 'the model after the question'));
    ctx.expect(textMentions(t3, feetRe(9), 'the 9ft wall height'));

    const afterQuestion = baselineOf(ctx.session);
    const t4 = await ctx.turn('Add a 3ft window to the east wall, centred');
    const p4 = ctx.session.bus.project;
    ctx.expect(answered(t4, 'the edit turn'));
    ctx.expect(noPlan(t4, 'the edit turn'));
    ctx.expect(oneUndoStep(ctx.session, afterQuestion, t4));
    ctx.expect(hasOpening(p4, { kind: 'window', wall: 'east', widthIn: 36 }).fail);
    ctx.expect(soundBuild(p4, ctx.session.catalog));
  },
});
