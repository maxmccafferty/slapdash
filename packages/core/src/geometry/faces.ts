/**
 * World-space faces of a part, and how two faces meet: the measurement behind "this rafter's
 * plumb cut sits flush on the ridge board".
 *
 * The faces come from the same triangles the renderer draws: the cut solid's surface
 * (`solidSurfaceTriangles`, which `renderer/cutGeometry.ts` normalises to the unit box) or
 * the plain box, taken to world space by `position + R·p` with R from `rotationAxes` (the
 * renderer's instance matrix T·R·S(size) applied to the size-normalised mesh is the same map).
 * So a gap measured here is a gap on screen.
 */
import type { PartCuts, PartSize } from '../model/schema.ts';
import { hasCuts, solidSurfaceTriangles } from './cuts.ts';
import { cross, dot, norm, rotationAxes, scale, type PartLike } from './obb.ts';
import type { Vec3 } from './vec3.ts';

export interface FacePartLike extends PartLike {
  cuts?: PartCuts | undefined;
}

/** A planar face of a part's surface in world mm: coplanar surface triangles merged. */
export interface PlanarFace {
  /** Outward unit normal. */
  normal: Vec3;
  /** Plane offset: dot(normal, p) for every point p on the face. */
  offset: number;
  /** The face's triangles, world mm. */
  triangles: Array<[Vec3, Vec3, Vec3]>;
  /** Distinct vertices of the face. */
  vertices: Vec3[];
  /** Area, mm². */
  area: number;
}

/** How a face meets an opposed face (see {@link faceContact}). */
export interface FaceContact {
  /** Angle between the face and the other face's plane, degrees (0 = parallel). */
  angleDeg: number;
  /**
   * Signed distances of this face's vertices from the other face's plane, along the other
   * face's outward normal: > 0 is a gap (air between them), < 0 is overlap (this face is
   * inside the other part). Both within ±tol means coplanar.
   */
  minGapMm: number;
  maxGapMm: number;
  /** Area where the two faces cover each other, projected on the other face's plane, mm². */
  overlapArea: number;
  /** World-y range of that shared area, or null if there is none. */
  overlapY: { min: number; max: number } | null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

function boxTriangles(size: PartSize): Float64Array {
  const { length: L, width: W, height: H } = size;
  const c = (x: number, y: number, z: number) => [x * L, y * W, z * H];
  // Each face as a quad wound counter-clockwise seen from outside.
  const quads = [
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], // x = 0
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], // x = L
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], // y = 0
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)], // y = W
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], // z = 0
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], // z = H
  ];
  return Float64Array.from(quads.flatMap(([a, b, cc, d]) => [...a!, ...b!, ...cc!, ...a!, ...cc!, ...d!]));
}

/**
 * The part's surface as planar faces in world mm. Triangles whose planes agree within
 * `tolMm` (and 0.01°) are merged into one face.
 */
export function partFaces(part: FacePartLike, tolMm = 0.01): PlanarFace[] {
  const tris = hasCuts(part) ? solidSurfaceTriangles(part.size, part.cuts) : boxTriangles(part.size);
  const [X, Y, Z] = rotationAxes(part.rotation);
  const o = part.position;
  const toW = (i: number): Vec3 => {
    const p = { x: tris[i]!, y: tris[i + 1]!, z: tris[i + 2]! };
    return {
      x: o.x + X.x * p.x + Y.x * p.y + Z.x * p.z,
      y: o.y + X.y * p.x + Y.y * p.y + Z.y * p.z,
      z: o.z + X.z * p.x + Y.z * p.y + Z.z * p.z,
    };
  };
  const faces: PlanarFace[] = [];
  const cosTol = Math.cos((0.01 * Math.PI) / 180);
  for (let i = 0; i < tris.length; i += 9) {
    const a = toW(i);
    const b = toW(i + 3);
    const c = toW(i + 6);
    const n2 = cross(sub(b, a), sub(c, a));
    const area2 = norm(n2);
    if (area2 < 1e-9) continue;
    const n = scale(n2, 1 / area2);
    const off = dot(n, a);
    let face = faces.find((f) => dot(f.normal, n) > cosTol && Math.abs(f.offset - off) < tolMm);
    if (!face) {
      face = { normal: n, offset: off, triangles: [], vertices: [], area: 0 };
      faces.push(face);
    }
    face.triangles.push([a, b, c]);
    face.area += area2 / 2;
    for (const v of [a, b, c]) {
      if (!face.vertices.some((w) => norm(sub(v, w)) < 1e-6)) face.vertices.push(v);
    }
  }
  return faces;
}

type P2 = { x: number; y: number };

/** Clip a convex polygon to the half-plane left of edge (a → b). */
function clipEdge(poly: P2[], a: P2, b: P2): P2[] {
  const side = (p: P2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

const area2d = (poly: P2[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
};

/**
 * How `face` meets `other`: the angle between them, how far `face` sits off `other`'s plane
 * (signed, + = gap), and the area they share once `face` is projected onto `other`'s plane.
 * Meant for opposed faces (normals pointing at each other); the area is 0 otherwise.
 */
export function faceContact(face: PlanarFace, other: PlanarFace): FaceContact {
  const n = other.normal;
  const angleDeg = (Math.acos(Math.min(1, Math.abs(dot(face.normal, n)))) * 180) / Math.PI;
  const d = face.vertices.map((v) => dot(n, v) - other.offset);
  const minGapMm = Math.min(...d);
  const maxGapMm = Math.max(...d);
  // In-plane axes on `other`: u along world up where possible, so y ranges read off directly.
  const up = { x: 0, y: 1, z: 0 };
  const upIn = sub(up, scale(n, dot(up, n)));
  const e1 = norm(upIn) > 1e-6 ? unit(upIn) : unit(cross(n, Math.abs(n.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 }));
  const e2 = cross(n, e1);
  const base = scale(n, other.offset);
  const to2 = (p: Vec3): P2 => {
    const r = sub(p, base);
    return { x: dot(r, e2), y: dot(r, e1) };
  };
  const ccw = (t: [Vec3, Vec3, Vec3]): P2[] => {
    const p = t.map(to2);
    return area2d(p) < 0 ? p.reverse() : p;
  };
  let overlapArea = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  if (dot(face.normal, n) < 0) {
    const others = other.triangles.map(ccw);
    for (const t of face.triangles) {
      const subject = ccw(t);
      for (const clip of others) {
        let poly = subject;
        for (let i = 0; i < clip.length && poly.length > 0; i++) poly = clipEdge(poly, clip[i]!, clip[(i + 1) % clip.length]!);
        if (poly.length < 3) continue;
        const a = area2d(poly);
        if (a < 1e-6) continue;
        overlapArea += a;
        for (const p of poly) {
          const w = add(base, add(scale(e2, p.x), scale(e1, p.y)));
          yMin = Math.min(yMin, w.y);
          yMax = Math.max(yMax, w.y);
        }
      }
    }
  }
  return { angleDeg, minGapMm, maxGapMm, overlapArea, overlapY: overlapArea > 0 ? { min: yMin, max: yMax } : null };
}

/** The largest |distance| between `face` and `other`'s plane. */
export const contactGap = (c: FaceContact): number => Math.max(Math.abs(c.minGapMm), Math.abs(c.maxGapMm));

/**
 * The face of `part` that meets `target` best: among faces opposed to it within
 * `maxAngleDeg`, the one nearest its plane (ties go to the larger shared area). Null if the
 * part has no opposed face.
 */
export function facingFace(
  part: FacePartLike,
  target: PlanarFace,
  maxAngleDeg = 1,
): { face: PlanarFace; contact: FaceContact } | null {
  let best: { face: PlanarFace; contact: FaceContact } | null = null;
  for (const face of partFaces(part)) {
    if (dot(face.normal, target.normal) >= 0) continue;
    const contact = faceContact(face, target);
    if (contact.angleDeg > maxAngleDeg) continue;
    if (
      !best ||
      contactGap(contact) < contactGap(best.contact) - 1e-6 ||
      (Math.abs(contactGap(contact) - contactGap(best.contact)) <= 1e-6 && contact.overlapArea > best.contact.overlapArea)
    ) {
      best = { face, contact };
    }
  }
  return best;
}

/** The face of `part` whose outward normal is closest to `dir` (ties go to the largest `dot(centroid, dir)`). */
export function faceToward(part: FacePartLike, dir: Vec3): PlanarFace {
  const d = unit(dir);
  const faces = partFaces(part);
  let best = faces[0]!;
  for (const f of faces) {
    const a = dot(f.normal, d);
    const b = dot(best.normal, d);
    if (a > b + 1e-9 || (a > b - 1e-9 && f.offset > best.offset)) best = f;
  }
  return best;
}
