/**
 * The cut-list optimizer (ADR-0002 §E7): first-fit decreasing, in house, deterministic
 * and simple enough to check by hand.
 *
 * 1. **Splice.** A piece longer than the longest stock length is split into
 *    `ceil(length / longest)` equal segments, each marked `spliced`.
 * 2. **Whole boards.** A piece that is at most `trim` shorter than some stock length gets a
 *    board of its own, the shortest such length (a 103 1/2in stud on a 104 5/8in precut).
 * 3. **First-fit decreasing.** The rest, longest first (ties by id), go into the first open
 *    board with room for the piece plus one kerf; if none has room, a board of the longest
 *    stock length is opened.
 * 4. **Downsize.** Each of those boards becomes the shortest stock length that still holds
 *    its pieces.
 *
 * Lengths are millimetres. A kerf is charged between two pieces on a board, never at the
 * ends.
 */
import type { StockLength } from '../catalog/schema.ts';
import { MM_PER_INCH } from '../units/length.ts';

/** Saw kerf charged between two cuts on one board: 1/8in. */
export const KERF_MM = MM_PER_INCH / 8;
/** The most a board may be longer than its one piece and still count as "the board as is": 1 1/4in. */
export const TRIM_MM = 1.25 * MM_PER_INCH;

const EPS = 1e-6;

export interface CutPiece {
  /** Usually the part id. Several pieces may share one when a part is spliced. */
  id: string;
  length_mm: number;
}

export interface PlacedPiece extends CutPiece {
  /** One of several equal segments of a part longer than any stock length. */
  spliced?: { index: number; of: number };
}

export interface Board {
  stock: StockLength;
  pieces: PlacedPiece[];
  /** Pieces plus kerfs between them. */
  used_mm: number;
  /** What is left of the board. */
  waste_mm: number;
}

export interface CutOptions {
  kerf_mm?: number;
  trim_mm?: number;
}

function used(pieces: readonly PlacedPiece[], kerf: number): number {
  if (pieces.length === 0) return 0;
  return pieces.reduce((s, p) => s + p.length_mm, 0) + kerf * (pieces.length - 1);
}

function byLengthDesc(a: PlacedPiece, b: PlacedPiece): number {
  if (Math.abs(a.length_mm - b.length_mm) > EPS) return b.length_mm - a.length_mm;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return (a.spliced?.index ?? 0) - (b.spliced?.index ?? 0);
}

function board(stock: StockLength, pieces: PlacedPiece[], kerf: number): Board {
  const u = used(pieces, kerf);
  return { stock, pieces, used_mm: u, waste_mm: stock.length_mm - u };
}

/**
 * Pack pieces into stock boards. `stock` may be in any order; the result is the same for
 * any order of `pieces`. Throws on a piece of zero or negative length, or empty stock.
 */
export function cutStock(pieces: readonly CutPiece[], stock: readonly StockLength[], opts: CutOptions = {}): Board[] {
  const kerf = opts.kerf_mm ?? KERF_MM;
  const trim = opts.trim_mm ?? TRIM_MM;
  if (pieces.length === 0) return [];
  if (stock.length === 0) throw new Error('There are no stock lengths to cut from.');
  for (const p of pieces) {
    if (!(p.length_mm > 0)) throw new Error(`Piece "${p.id}" has a length of ${p.length_mm} mm; a piece must be longer than zero.`);
  }
  const lengths = [...stock].sort((a, b) => a.length_mm - b.length_mm);
  const longest = lengths[lengths.length - 1]!;

  // 1. Splice.
  const all: PlacedPiece[] = [];
  for (const p of pieces) {
    if (p.length_mm <= longest.length_mm + EPS) {
      all.push({ id: p.id, length_mm: p.length_mm });
      continue;
    }
    const n = Math.ceil(p.length_mm / longest.length_mm - EPS);
    for (let i = 0; i < n; i++) all.push({ id: p.id, length_mm: p.length_mm / n, spliced: { index: i + 1, of: n } });
  }
  all.sort(byLengthDesc);

  // 2. Whole boards.
  const whole: Board[] = [];
  const rest: PlacedPiece[] = [];
  for (const p of all) {
    const fit = lengths.find((s) => s.length_mm - p.length_mm >= -EPS && s.length_mm - p.length_mm <= trim + EPS);
    if (fit) whole.push(board(fit, [p], kerf));
    else rest.push(p);
  }

  // 3. First-fit decreasing on the longest stock.
  const open: PlacedPiece[][] = [];
  for (const p of rest) {
    const target = open.find((b) => used(b, kerf) + (b.length > 0 ? kerf : 0) + p.length_mm <= longest.length_mm + EPS);
    if (target) target.push(p);
    else open.push([p]);
  }

  // 4. Downsize.
  const packed = open.map((ps) => {
    const u = used(ps, kerf);
    const fit = lengths.find((s) => s.length_mm >= u - EPS) ?? longest;
    return board(fit, ps, kerf);
  });

  return [...whole, ...packed];
}
