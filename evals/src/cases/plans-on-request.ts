import { calledTool, nothingChanged, planShown } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep } from './common.ts';

/** Plans are opt-in (ADR-0002 §F1): asking for them turns the check on, and the next big change waits for Build it. */
export const plansOnRequest = defineScenario({
  name: 'plans-on-request',
  description: 'Asking to see plans first turns the check on: a 10×12 shed gets a plan, then builds on Build it',
  async run(ctx) {
    const t1 = await ctx.turn('Show me a plan before you build anything big. Build a 10×12 shed on a slab with 8ft walls.');
    ctx.expect(calledTool(t1, 'set_preferences'));
    ctx.expect(ctx.session.memory.prefs.confirmBigChanges === true ? null : 'the big-change check should be on afterwards');
    ctx.expect(planShown(t1, 'turn 1'));
    ctx.expect(nothingChanged(ctx.session, ctx.baseline, 'turn 1'));
    const t2 = await ctx.turn({ text: 'Build it', approvePlan: true });
    expectSoundStep(ctx, t2);
  },
});
