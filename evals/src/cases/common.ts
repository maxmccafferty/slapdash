/** Steps several scenarios share. */
import { noPlan, oneUndoStep, soundBuild } from '../checks.ts';
import type { ScenarioContext, Turn } from '../scenario.ts';

/**
 * The build turn: the request, built straight away with no plan (ADR-0002 §F1 is opt-in, and
 * off by default). Returns the turn.
 */
export async function buildInOneTurn(ctx: ScenarioContext, prompt: string): Promise<Turn> {
  const t = await ctx.turn(prompt);
  ctx.expect(noPlan(t, 'the build turn'));
  return t;
}

/** The building turn made one undo step and the result is sound (valid joints, nothing loose, no clashes). */
export function expectSoundStep(ctx: ScenarioContext, t: Turn): void {
  ctx.expect(oneUndoStep(ctx.session, ctx.baseline, t));
  ctx.expect(soundBuild(ctx.session.bus.project, ctx.session.catalog));
}
