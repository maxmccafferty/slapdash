/**
 * Draws a `PdfDoc` with pdf-lib. Text is set in the vendored Geist (OFL-1.1) when its bytes
 * are given, else in Helvetica; either way every character the font lacks is swapped for an
 * ASCII stand-in first, so an export never fails on a glyph.
 */
import fontkit from '@pdf-lib/fontkit';
import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type Color, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Hex, PdfDoc, PdfItem } from './pdf-types.ts';

export interface FontBytes {
  regular: Uint8Array | ArrayBuffer;
  semibold: Uint8Array | ArrayBuffer;
}

/** ASCII stand-ins for characters a font may lack. */
const FALLBACKS: Record<string, string> = {
  '′': "'",
  '″': '"',
  '×': 'x',
  '–': '-',
  '—': '-',
  '…': '...',
  '·': '-',
  '³': '3',
  '²': '2',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
};

/** Replace each character `has` says the font lacks with its stand-in, or "?". */
export function sanitizeText(text: string, has: (codePoint: number) => boolean): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (has(cp)) out += ch;
    else {
      const sub = FALLBACKS[ch] ?? '?';
      out += [...sub].every((c) => has(c.codePointAt(0)!)) ? sub : '?';
    }
  }
  return out;
}

function color(hex: Hex): Color {
  const n = Number.parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  has: { regular: (cp: number) => boolean; semibold: (cp: number) => boolean };
}

function charSet(font: PDFFont): (cp: number) => boolean {
  const set = new Set(font.getCharacterSet());
  return (cp) => set.has(cp);
}

async function embedFonts(doc: PDFDocument, bytes: FontBytes | null): Promise<Fonts> {
  let regular: PDFFont;
  let semibold: PDFFont;
  if (bytes) {
    doc.registerFontkit(fontkit);
    regular = await doc.embedFont(bytes.regular, { subset: true });
    semibold = await doc.embedFont(bytes.semibold, { subset: true });
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    semibold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  return { regular, semibold, has: { regular: charSet(regular), semibold: charSet(semibold) } };
}

function draw(page: PDFPage, item: PdfItem, fonts: Fonts): void {
  const H = page.getHeight();
  switch (item.type) {
    case 'text': {
      const font = item.weight === 600 ? fonts.semibold : fonts.regular;
      const text = sanitizeText(item.text, item.weight === 600 ? fonts.has.semibold : fonts.has.regular);
      const w = font.widthOfTextAtSize(text, item.size);
      const shift = item.align === 'center' ? w / 2 : item.align === 'right' ? w : 0;
      const a = ((item.rotate ?? 0) * Math.PI) / 180;
      // Page coordinates are y down; the start point moves back along the (clockwise) baseline.
      const sx = item.x - Math.cos(a) * shift;
      const sy = item.y - Math.sin(a) * shift;
      page.drawText(text, { x: sx, y: H - sy, size: item.size, font, color: color(item.color), ...(item.rotate ? { rotate: degrees(-item.rotate) } : {}) });
      return;
    }
    case 'line':
      page.drawLine({
        start: { x: item.x1, y: H - item.y1 },
        end: { x: item.x2, y: H - item.y2 },
        thickness: item.width,
        color: color(item.color),
        lineCap: LineCapStyle.Round,
        ...(item.dash ? { dashArray: item.dash } : {}),
      });
      return;
    case 'rect':
      page.drawRectangle({
        x: item.x,
        y: H - item.y - item.h,
        width: item.w,
        height: item.h,
        ...(item.fill ? { color: color(item.fill) } : {}),
        ...(item.stroke ? { borderColor: color(item.stroke), borderWidth: item.width ?? 0.5 } : {}),
      });
      return;
    case 'tick':
      page.drawRectangle({ x: item.x, y: H - item.y - item.size, width: item.size, height: item.size, borderColor: color(item.color), borderWidth: 0.75 });
      return;
    case 'circle':
      page.drawCircle({
        x: item.x,
        y: H - item.y,
        size: item.r,
        ...(item.fill ? { color: color(item.fill) } : {}),
        ...(item.stroke ? { borderColor: color(item.stroke), borderWidth: item.width ?? 0.5 } : {}),
        ...(item.dash ? { borderDashArray: item.dash } : {}),
      });
      return;
    case 'path':
      // drawSvgPath reads the path y down from (x, y): the page's top-left corner.
      page.drawSvgPath(item.d, {
        x: 0,
        y: H,
        ...(item.fill ? { color: color(item.fill) } : {}),
        ...(item.stroke ? { borderColor: color(item.stroke), borderWidth: item.width ?? 0.5, borderLineCap: LineCapStyle.Round } : {}),
        ...(item.dash ? { borderDashArray: item.dash } : {}),
      });
      return;
  }
}

/**
 * The PDF bytes. With `fonts`, text is Geist; without (or if embedding fails), Helvetica.
 * `createdOn` fixes the creation date, for reproducible output in tests.
 */
export async function renderPdf(pdf: PdfDoc, fonts: FontBytes | null = null, opts: { createdOn?: Date } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdf.title);
  doc.setProducer('Slapdash');
  doc.setCreator('Slapdash');
  if (opts.createdOn) {
    doc.setCreationDate(opts.createdOn);
    doc.setModificationDate(opts.createdOn);
  }
  let embedded: Fonts;
  try {
    embedded = await embedFonts(doc, fonts);
  } catch {
    embedded = await embedFonts(doc, null);
  }
  for (const p of pdf.pages) {
    const page = doc.addPage([p.width, p.height]);
    for (const item of p.items) draw(page, item, embedded);
  }
  return doc.save();
}
