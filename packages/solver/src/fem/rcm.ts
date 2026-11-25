/**
 * Reverse Cuthill–McKee ordering of the node graph, started from a pseudo-peripheral
 * node (George–Liu), to keep the skyline profile small.
 */

/** BFS levels from `start`, over the nodes not yet `done`. */
function levels(adj: readonly (readonly number[])[], start: number, done: Uint8Array): { order: number[]; depth: Int32Array } {
  const depth = new Int32Array(adj.length).fill(-1);
  const order = [start];
  depth[start] = 0;
  for (let h = 0; h < order.length; h++) {
    const v = order[h]!;
    for (const w of adj[v]!) {
      if (depth[w] === -1 && !done[w]) {
        depth[w] = depth[v]! + 1;
        order.push(w);
      }
    }
  }
  return { order, depth };
}

function pseudoPeripheral(adj: readonly (readonly number[])[], start: number, done: Uint8Array): number {
  let node = start;
  let ecc = -1;
  for (let iter = 0; iter < 8; iter++) {
    const { order, depth } = levels(adj, node, done);
    const last = order[order.length - 1]!;
    const maxDepth = depth[last]!;
    if (maxDepth <= ecc) break;
    ecc = maxDepth;
    // The lowest-degree node on the last level.
    let best = last;
    for (let i = order.length - 1; i >= 0 && depth[order[i]!] === maxDepth; i--) {
      if (adj[order[i]!]!.length < adj[best]!.length) best = order[i]!;
    }
    node = best;
  }
  return node;
}

/** `perm[k]` is the node placed k-th; `inverse[node]` is its position. */
export function reverseCuthillMcKee(adj: readonly (readonly number[])[]): { perm: Int32Array; inverse: Int32Array } {
  const n = adj.length;
  const done = new Uint8Array(n);
  const cm: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    if (done[seed]) continue;
    const start = pseudoPeripheral(adj, seed, done);
    done[start] = 1;
    const queue = [start];
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h]!;
      cm.push(v);
      const next = adj[v]!.filter((w) => !done[w]).sort((a, b) => adj[a]!.length - adj[b]!.length || a - b);
      for (const w of next) {
        done[w] = 1;
        queue.push(w);
      }
    }
  }
  const perm = Int32Array.from(cm.reverse());
  const inverse = new Int32Array(n);
  for (let k = 0; k < n; k++) inverse[perm[k]!] = k;
  return { perm, inverse };
}

/** Sum of column heights for a node ordering (6 DOFs per node): the skyline's size. */
export function profileSize(adj: readonly (readonly number[])[], inverse: Int32Array): number {
  let total = 0;
  for (let v = 0; v < adj.length; v++) {
    let first = inverse[v]!;
    for (const w of adj[v]!) first = Math.min(first, inverse[w]!);
    const height = inverse[v]! - first;
    // Six columns per node, each spanning the node block plus everything above it.
    for (let d = 0; d < 6; d++) total += height * 6 + d + 1;
  }
  return total;
}

/**
 * Estimated LDLᵀ work for a node ordering: Σ over columns of height², with six DOFs per
 * node. Factor time grows with this, not with the profile alone.
 */
export function factorWork(adj: readonly (readonly number[])[], inverse: Int32Array): number {
  let total = 0;
  for (let v = 0; v < adj.length; v++) {
    let first = inverse[v]!;
    for (const w of adj[v]!) first = Math.min(first, inverse[w]!);
    const h = (inverse[v]! - first) * 6;
    for (let d = 0; d < 6; d++) total += (h + d) ** 2;
  }
  return total;
}

/**
 * The cheapest of several orderings: RCM, and sweeps of the node positions along a few
 * plan directions and up. Buildings are often rings of walls, where RCM wraps around
 * and a straight sweep across the plan keeps the fronts shorter.
 */
export function chooseOrdering(
  adj: readonly (readonly number[])[],
  coords: readonly (readonly [number, number, number])[],
): { perm: Int32Array; inverse: Int32Array; name: string } {
  const n = adj.length;
  const candidates: Array<{ name: string; perm: Int32Array; inverse: Int32Array }> = [];
  const rcm = reverseCuthillMcKee(adj);
  candidates.push({ name: 'rcm', ...rcm });
  const dirs: Array<[string, [number, number, number]]> = [['y', [0, 1, 0]]];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 8;
    dirs.push([`plan ${k * 22.5}°`, [Math.cos(a), 0, Math.sin(a)]]);
  }
  for (const [name, d] of dirs) {
    const key = coords.map((p) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2]);
    const perm = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => key[a]! - key[b]! || a - b);
    const inverse = new Int32Array(n);
    for (let k = 0; k < n; k++) inverse[perm[k]!] = k;
    candidates.push({ name: `sweep ${name}`, perm, inverse });
  }
  let best = candidates[0]!;
  let bestWork = factorWork(adj, best.inverse);
  for (const c of candidates.slice(1)) {
    const w = factorWork(adj, c.inverse);
    if (w < bestWork) {
      best = c;
      bestWork = w;
    }
  }
  return best;
}
