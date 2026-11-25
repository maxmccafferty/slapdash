/**
 * The cut-list optimizer, on cases worked by hand. Stock is written in inches for
 * readability and converted here. Kerf is 1/8in and trim 1 1/4in unless stated.
 */
import { describe, expect, it } from 'vitest';
import { KERF_MM, TRIM_MM, cutStock, type Board, type CutPiece, type StockLength } from '../../src/index.ts';

const IN = 25.4;
const stockIn = (...inches: number[]): StockLength[] => inches.map((i) => ({ length_mm: i * IN }));
const pieceIn = (...inches: number[]): CutPiece[] => inches.map((i, n) => ({ id: `P${String(n + 1).padStart(2, '0')}`, length_mm: i * IN }));
const lengthsIn = (b: Board) => b.pieces.map((p) => Math.round((p.length_mm / IN) * 1000) / 1000);
const boardIn = (b: Board) => Math.round((b.stock.length_mm / IN) * 1000) / 1000;

const TWO_BY_FOUR = [
  { length_mm: 92.625 * IN, name: 'precut stud' },
  { length_mm: 96 * IN },
  { length_mm: 104.625 * IN, name: 'precut stud' },
  ...stockIn(120, 144, 168, 192, 240),
];
const BOARDS = stockIn(96, 120, 144, 168, 192, 240);

describe('cutStock', () => {
  it('the constants are 1/8in kerf and 1 1/4in trim', () => {
    expect(KERF_MM).toBeCloseTo(3.175, 9);
    expect(TRIM_MM).toBeCloseTo(31.75, 9);
  });

  it('puts 103 1/2in studs on 104 5/8in precut studs, one each', () => {
    const boards = cutStock(pieceIn(103.5, 103.5, 103.5), TWO_BY_FOUR);
    expect(boards).toHaveLength(3);
    for (const b of boards) {
      expect(boardIn(b)).toBe(104.625);
      expect(b.stock.name).toBe('precut stud');
      expect(b.waste_mm / IN).toBeCloseTo(1.125, 9);
    }
  });

  it('charges a kerf between pieces: 60 + 1/8 + 36 needs a 10ft board, not an 8ft one', () => {
    const withKerf = cutStock(pieceIn(60, 36), BOARDS);
    expect(withKerf.map(boardIn)).toEqual([120]);
    expect(withKerf[0]!.used_mm / IN).toBeCloseTo(96.125, 9);
    const noKerf = cutStock(pieceIn(60, 36), BOARDS, { kerf_mm: 0 });
    expect(noKerf.map(boardIn)).toEqual([96]);
  });

  it('first-fit decreasing on one 96in length, kerf 0, by hand', () => {
    const boards = cutStock(pieceIn(50, 40, 30, 30, 20, 20), stockIn(96), { kerf_mm: 0 });
    expect(boards.map(lengthsIn)).toEqual([[50, 40], [30, 30, 20], [20]]);
  });

  it('downsizes to the shortest length that holds the pieces', () => {
    const boards = cutStock(pieceIn(50, 50), stockIn(96, 120, 144));
    expect(boards.map(boardIn)).toEqual([120]);
    expect(boards[0]!.used_mm / IN).toBeCloseTo(100.125, 9);
  });

  it('splices a piece longer than the longest stock into equal segments', () => {
    const boards = cutStock(pieceIn(300), BOARDS);
    expect(boards.map(boardIn)).toEqual([168, 168]);
    expect(boards.map(lengthsIn)).toEqual([[150], [150]]);
    expect(boards.map((b) => b.pieces[0]!.spliced)).toEqual([
      { index: 1, of: 2 },
      { index: 2, of: 2 },
    ]);
    expect(boards.every((b) => b.pieces[0]!.id === 'P01')).toBe(true);
  });

  it('an exact match is a whole board with no kerf', () => {
    const boards = cutStock(pieceIn(240), BOARDS);
    expect(boards.map(boardIn)).toEqual([240]);
    expect(boards[0]!.used_mm).toBeCloseTo(240 * IN, 9);
    expect(boards[0]!.waste_mm).toBeCloseTo(0, 9);
  });

  it('is deterministic: equal lengths keep id order and input order does not matter', () => {
    const pieces: CutPiece[] = [
      { id: 'B', length_mm: 40 * IN },
      { id: 'A', length_mm: 40 * IN },
      { id: 'C', length_mm: 70 * IN },
      { id: 'D', length_mm: 20 * IN },
    ];
    const a = cutStock(pieces, BOARDS);
    const b = cutStock([...pieces].reverse(), [...BOARDS].reverse());
    expect(b).toEqual(a);
    const ids = a.flatMap((x) => x.pieces.map((p) => p.id));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
  });

  it('gives no boards for no pieces, and refuses a piece of no length', () => {
    expect(cutStock([], BOARDS)).toEqual([]);
    expect(() => cutStock([{ id: 'X', length_mm: 0 }], BOARDS)).toThrow('Piece "X" has a length of 0 mm; a piece must be longer than zero.');
    expect(() => cutStock([{ id: 'X', length_mm: -5 }], BOARDS)).toThrow(/longer than zero/);
    expect(() => cutStock(pieceIn(10), [])).toThrow('There are no stock lengths to cut from.');
  });

  it('every board holds its pieces and kerfs, and every piece is placed once (random inputs)', () => {
    // mulberry32: a small seeded PRNG, so failures reproduce.
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let run = 0; run < 200; run++) {
      const n = 1 + Math.floor(rand() * 30);
      const pieces: CutPiece[] = Array.from({ length: n }, (_, i) => ({ id: `P${i}`, length_mm: (1 + rand() * 300) * IN }));
      const boards = cutStock(pieces, TWO_BY_FOUR);
      for (const b of boards) {
        const sum = b.pieces.reduce((s, p) => s + p.length_mm, 0) + KERF_MM * (b.pieces.length - 1);
        expect(sum).toBeLessThanOrEqual(b.stock.length_mm + 1e-6);
        expect(b.used_mm).toBeCloseTo(sum, 6);
      }
      for (const p of pieces) {
        const placed = boards.flatMap((b) => b.pieces).filter((x) => x.id === p.id);
        expect(placed.reduce((s, x) => s + x.length_mm, 0)).toBeCloseTo(p.length_mm, 6);
      }
    }
  });
});
