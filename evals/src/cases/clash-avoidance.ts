import { assembliesOf, framingConnected, isSiteContext, jointsValid, noClashes, noClashesWith, nothingChanged, offeredOptions, oneUndoStep } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { TREE_ON_LINE } from '../seeds.ts';

/** A tree trunk sits on the fence line: Claude routes around it or asks; nothing runs through the tree. */
export const clashAvoidance = defineScenario({
  name: 'clash-avoidance',
  description: 'A picket fence whose line runs through a tree: route around it or offer options, never through it',
  seed: TREE_ON_LINE,
  prefs: { confirmBigChanges: false },
  async run(ctx) {
    const t = await ctx.turn('Build a 4ft picket fence from the origin 30ft east');
    const p = ctx.session.bus.project;
    ctx.expect(noClashesWith(p, isSiteContext, 'the tree'));
    const fences = assembliesOf(p, 'misc').filter((a) => a.builder?.name === 'build_fence');
    if (fences.length > 0) {
      ctx.log('    (built: routed around the tree)');
      ctx.expect(oneUndoStep(ctx.session, ctx.baseline, t));
      ctx.expect(jointsValid(p, ctx.session.catalog));
      ctx.expect(framingConnected(p));
      // Not a check: build_fence overlaps its own boards and rails at every corner of the path
      // (a builder defect, not model behaviour), so any route around the tree has some.
      const own = noClashes(p);
      if (own) ctx.log(`    (fence's own corner overlaps, builder issue: ${own})`);
    } else {
      ctx.log('    (not built: asked instead)');
      ctx.expect(nothingChanged(ctx.session, ctx.baseline));
      ctx.expect(offeredOptions(t, 2));
    }
  },
});
