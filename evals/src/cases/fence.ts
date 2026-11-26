import { assembliesOf, boundsOf, FT, fi, heightAboveGrade, IN, partsIn } from '../checks.ts';
import { defineScenario } from '../scenario.ts';
import { expectSoundStep, planThenBuild } from './common.ts';

/** A 40ft privacy fence: posts at most 8ft apart, 6ft tall, rails in every bay, boards on. */
export const fence = defineScenario({
  name: 'fence',
  description: '40ft privacy fence along the north edge: posts ≤ 8ft apart, 6ft tall, rails and boards',
  fullBuild: true,
  async run(ctx) {
    const t2 = await planThenBuild(ctx, 'Build a 6ft privacy fence 40ft long along the north edge, starting at the origin and running east');
    const p = ctx.session.bus.project;
    expectSoundStep(ctx, t2);
    const fences = assembliesOf(p, 'misc').filter((a) => a.builder?.name === 'build_fence');
    ctx.expect(fences.length === 1 ? null : `one fence (got ${fences.length})`);
    const f = fences[0];
    if (!f) return;
    const parts = partsIn(p, f.id);
    const posts = parts.filter((x) => x.role === 'post');
    const rails = parts.filter((x) => x.role === 'rail');
    const boards = parts.filter((x) => x.role === 'panel');
    ctx.expect(posts.length >= 6 ? null : `at least 6 posts for 40ft at ≤ 8ft spacing (got ${posts.length})`);
    // Post centres along the line (east-west): each neighbour within 8ft.
    const xs = posts
      .map((x) => boundsOf([x])!)
      .map((b) => (b.min.x + b.max.x) / 2)
      .sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    const widest = Math.max(0, ...gaps);
    ctx.expect(widest <= 8 * FT + IN ? null : `posts should be at most 8ft apart (widest gap ${fi(widest)})`);
    const span = xs.length > 1 ? xs.at(-1)! - xs[0]! : 0;
    ctx.expect(Math.abs(span - 40 * FT) <= 6 * IN ? null : `the fence should run 40ft (posts span ${fi(span)})`);
    ctx.expect(heightAboveGrade(p, f.id, 6));
    const bays = Math.max(1, posts.length - 1);
    ctx.expect(rails.length >= 2 * bays ? null : `at least 2 rails per bay (${rails.length} rails for ${bays} bays)`);
    ctx.expect(boards.length > 0 ? null : 'the fence should have boards');
  },
});
