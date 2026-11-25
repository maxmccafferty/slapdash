/** Steps several scenarios share. */
import { nothingChanged, oneUndoStep, planShown, soundBuild } from '../checks.ts';
import type { ScenarioContext, Turn } from '../scenario.ts';

/**
 * Turn A: the request, which must end with a plan and change nothing.
 * Turn B: "Build it" (approving the plan). Returns turn B.
 */
export async function planThenBuild(ctx: ScenarioContext, prompt: string): Promise<Turn> {
  const t1 = await ctx.turn(prompt);
  ctx.expect(planShown(t1, 'turn 1'));
  ctx.expect(nothingChanged(ctx.session, ctx.baseline, 'turn 1'));
  return ctx.turn({ text: 'Build it', approvePlan: true });
}

/** The building turn made one undo step and the result is sound (valid joints, nothing loose, no clashes). */
export function expectSoundStep(ctx: ScenarioContext, t: Turn): void {
  ctx.expect(oneUndoStep(ctx.session, ctx.baseline, t));
  ctx.expect(soundBuild(ctx.session.bus.project, ctx.session.catalog));
}
