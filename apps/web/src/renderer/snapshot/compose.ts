/**
 * Turning read-back pixels into the snapshot PNG: flip the rows, lay out the four-view
 * sheet, and draw tile captions, ID labels and the north arrow in 2D (so they are crisp,
 * and so nothing about labels depends on the 3D scene). Layout and label placement are
 * pure and tested; drawing needs a DOM canvas.
 */
import { SCENE_COLORS } from '../../styles/tokens.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SheetTileId = 'top' | 'front' | 'right' | 'iso';

export interface SheetTile {
  id: SheetTileId;
  caption: string;
  /** In image pixels, y down. */
  rect: Rect;
}

export const SHEET_CAPTIONS: Record<SheetTileId, string> = {
  top: 'Top',
  front: 'Front (south)',
  right: 'Right (east)',
  iso: '3D',
};

/** The four-view sheet: a 2 × 2 grid of `size / 2` tiles, top / front on the first row. */
export function sheetLayout(size: number): SheetTile[] {
  const half = Math.floor(size / 2);
  const order: SheetTileId[] = ['top', 'front', 'right', 'iso'];
  return order.map((id, i) => ({
    id,
    caption: SHEET_CAPTIONS[id],
    rect: { x: (i % 2) * half, y: Math.floor(i / 2) * half, w: half, h: half },
  }));
}

export interface LabelRequest {
  text: string;
  /** Anchor in image pixels. */
  x: number;
  y: number;
}

export interface PlacedLabel extends LabelRequest {
  box: Rect;
}

export const MAX_LABELS = 40;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels centred above their anchors, nudging each one down (then up) in steps until
 * it no longer overlaps one already placed. Labels that can't be placed inside `bounds`
 * are dropped, and at most {@link MAX_LABELS} are kept.
 */
export function placeLabels(
  labels: readonly LabelRequest[],
  measure: (text: string) => { w: number; h: number },
  bounds: Rect,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const label of labels) {
    if (placed.length >= MAX_LABELS) break;
    const { w, h } = measure(label.text);
    const step = h + 2;
    const tries = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    for (const k of tries) {
      const box = {
        x: Math.round(Math.min(Math.max(label.x - w / 2, bounds.x), bounds.x + bounds.w - w)),
        y: Math.round(label.y - h - 4 + k * step),
        w,
        h,
      };
      if (box.y < bounds.y || box.y + box.h > bounds.y + bounds.h) continue;
      if (placed.some((p) => overlaps(p.box, box))) continue;
      placed.push({ ...label, box });
      break;
    }
  }
  return placed;
}

export const LABEL_FONT = '600 14px "Geist Variable", Geist, system-ui, sans-serif';
export const CAPTION_FONT = '600 16px "Geist Variable", Geist, system-ui, sans-serif';

/** RGBA rows read back from WebGL (bottom-up) → an ImageData (top-down). */
export function flipRows(pixels: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  return out;
}

export interface ComposeInput {
  pixels: Uint8Array;
  width: number;
  height: number;
  tiles: { caption: string | null; rect: Rect; north: boolean }[];
  labels: LabelRequest[];
}

function drawNorth(ctx: CanvasRenderingContext2D, rect: Rect, scale: number) {
  const x = rect.x + rect.w - 28 * scale;
  const y = rect.y + 18 * scale;
  ctx.save();
  ctx.fillStyle = SCENE_COLORS.ink;
  ctx.strokeStyle = SCENE_COLORS.ink;
  ctx.lineWidth = 1.5 * scale;
  ctx.font = CAPTION_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', x, y);
  ctx.beginPath();
  ctx.moveTo(x, y + 40 * scale);
  ctx.lineTo(x, y + 20 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5 * scale, y + 26 * scale);
  ctx.lineTo(x, y + 18 * scale);
  ctx.lineTo(x + 5 * scale, y + 26 * scale);
  ctx.fill();
  ctx.restore();
}

/** Draw everything on a 2D canvas and encode the PNG. Browser only. */
export async function composePng(input: ComposeInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = input.width;
  canvas.height = input.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't draw the snapshot: this browser has no 2D canvas.");
  ctx.putImageData(new ImageData(flipRows(input.pixels, input.width, input.height), input.width, input.height), 0, 0);
  const scale = Math.max(1, input.width / 768);

  ctx.font = CAPTION_FONT;
  ctx.textBaseline = 'top';
  for (const tile of input.tiles) {
    if (tile.caption) {
      ctx.fillStyle = SCENE_COLORS.ink;
      ctx.fillText(tile.caption, tile.rect.x + 12 * scale, tile.rect.y + 10 * scale);
    }
    if (tile.north) drawNorth(ctx, tile.rect, scale);
    if (input.tiles.length > 1) {
      ctx.strokeStyle = SCENE_COLORS.hairline;
      ctx.lineWidth = 1;
      ctx.strokeRect(tile.rect.x + 0.5, tile.rect.y + 0.5, tile.rect.w - 1, tile.rect.h - 1);
    }
  }

  ctx.font = LABEL_FONT;
  const measure = (text: string) => ({ w: Math.ceil(ctx.measureText(text).width) + 8, h: 20 });
  const placed = placeLabels(input.labels, measure, { x: 0, y: 0, w: input.width, h: input.height });
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const l of placed) {
    ctx.fillStyle = SCENE_COLORS.paper;
    ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
    ctx.strokeStyle = SCENE_COLORS.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(l.box.x + 0.5, l.box.y + 0.5, l.box.w - 1, l.box.h - 1);
    ctx.fillStyle = SCENE_COLORS.ink;
    ctx.fillText(l.text, l.box.x + l.box.w / 2, l.box.y + l.box.h / 2 + 1);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the snapshot as a PNG."))), 'image/png');
  });
}
