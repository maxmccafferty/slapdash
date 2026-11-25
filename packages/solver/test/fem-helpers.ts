/** Hand-made analytical models for the kernel and textbook tests (no project mapping). */
import type { Axes, SectionProps, V3 } from '../src/fem/element.ts';
import type { FemElement, FemLink, FemModel } from '../src/fem/solve.ts';

export const PROPS: SectionProps = { E: 10_000, G: 4_000, A: 5_000, Iy: 2e7, Iz: 5e6, J: 3e6 };
/** Stiff enough to act rigid; soft enough to keep the matrix well conditioned. */
export const RIGID = 1e15;
export const PIN = 1e-3;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Axes for a member from p to q, with local y as close to `yHint` as possible. */
export function axesFor(p: V3, q: V3, yHint: V3 = [0, 1, 0]): Axes {
  const x = unit(sub(q, p));
  let z = cross(x, yHint);
  if (len(z) < 1e-9) z = cross(x, [0, 0, 1]);
  z = unit(z);
  const y = cross(z, x);
  return [x, y, z];
}

export class Builder {
  nodes: V3[] = [];
  elements: FemElement[] = [];
  links: FemLink[] = [];
  node(p: V3): number {
    this.nodes.push(p);
    return this.nodes.length - 1;
  }
  /** A straight member from node a to node b split into `n` elements; returns the node ids along it. */
  member(a: number, b: number, n = 1, props = PROPS, opts: { truss?: boolean; yHint?: V3 } = {}): number[] {
    const p = this.nodes[a]!;
    const q = this.nodes[b]!;
    const axes = axesFor(p, q, opts.yHint);
    const ids = [a];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ids.push(this.node([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]));
    }
    ids.push(b);
    const L = len(sub(q, p)) / n;
    for (let i = 0; i < n; i++) this.elements.push({ n1: ids[i]!, n2: ids[i + 1]!, axes, L, props, truss: opts.truss ?? false });
    return ids;
  }
  fix(node: number): void {
    this.links.push({ a: node, b: -1, kt: RIGID, kr: RIGID });
  }
  pin(node: number): void {
    this.links.push({ a: node, b: -1, kt: RIGID, kr: PIN });
  }
  model(): FemModel {
    return { nodes: this.nodes, elements: this.elements, links: this.links };
  }
}
