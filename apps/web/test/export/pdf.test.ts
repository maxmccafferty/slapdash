/**
 * The exported PDF: the layout as data (pages, sections, overflow, footers) and the
 * rendered bytes, with the vendored Geist and with the Helvetica fallback.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { indexCatalog, type MaterialsReport, type MaterialsRow } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { beforeAll, describe, expect, it } from 'vitest';
import { pdfInput, projectSlug } from '../../src/export/export-pdf.ts';
import { FOOTER_NOTE, layoutPdf, type PdfInput } from '../../src/export/pdf-layout.ts';
import { renderPdf, sanitizeText, type FontBytes } from '../../src/export/pdf-render.ts';
import { LETTER, MARGIN, type PdfDoc, type PdfItem } from '../../src/export/pdf-types.ts';
import { sampleBus } from '../renderer/fixtures.ts';

const FONTS = join(import.meta.dirname, '../../src/export/fonts');
const geist = (): FontBytes => ({
  regular: readFileSync(join(FONTS, 'Geist-Regular.ttf')),
  semibold: readFileSync(join(FONTS, 'Geist-SemiBold.ttf')),
});

const catalog = indexCatalog(CATALOG);
const NOW = new Date(Date.UTC(2026, 10, 25, 12));
const texts = (items: readonly PdfItem[]) => items.flatMap((i) => (i.type === 'text' ? [i.text] : []));

function poolHouseInput(): PdfInput {
  return pdfInput(sampleBus().project, catalog, NOW);
}

/** The pool house's report with its Walls group padded to `n` rows. */
function longReport(base: MaterialsReport, n: number): MaterialsReport {
  const walls = base.groups.find((g) => g.step === 'walls')!;
  const template = walls.rows[0]!;
  const rows: MaterialsRow[] = Array.from({ length: n }, (_, i) => ({ ...template, id: `walls:fake-${i}`, name: `Row ${i + 1}` }));
  return { ...base, groups: base.groups.map((g) => (g.step === 'walls' ? { ...g, rows } : g)) };
}

describe('layoutPdf', () => {
  let doc: PdfDoc;
  beforeAll(() => {
    doc = layoutPdf(poolHouseInput());
  });

  it('gives the pool house exactly three letter pages: drawings, materials, cut list', () => {
    expect(doc.pages.map((p) => p.section)).toEqual(['drawings', 'materials', 'cut-list']);
    for (const p of doc.pages) expect([p.width, p.height]).toEqual([LETTER.width, LETTER.height]);
  });

  it('page 1 has the name, the specs and the drawing as vectors with its dimensions', () => {
    const [drawings] = doc.pages;
    const t = texts(drawings!.items);
    expect(t).toContain('Pool house');
    expect(t).toContain('Footprint');
    for (const label of ['20′ 0″', '16′ 0″', '9′ 0″', '6 in 12', 'North', 'South', 'East', 'West', 'N']) expect(t, label).toContain(label);
    expect(drawings!.items.some((i) => i.type === 'path')).toBe(true);
    expect(drawings!.items.some((i) => i.type === 'line')).toBe(true);
  });

  it('page 2 has the groups, the column labels, the Total, the price date and the caveat', () => {
    const t = texts(doc.pages[1]!.items);
    for (const s of ['Materials', 'Slab', 'Walls', 'Roof', 'Amount', 'Cost', 'Total', 'no price yet']) expect(t, s).toContain(s);
    expect(t.some((s) => /^\$[\d,]+–\$[\d,]+$/.test(s))).toBe(true);
    expect(t).toContain('Prices from 25 Nov 2026. Planning estimates, not quotes.');
    // One swatch dot per row.
    const rows = poolHouseInput().report.groups.reduce((s, g) => s + g.rows.length, 0);
    expect(doc.pages[1]!.items.filter((i) => i.type === 'circle')).toHaveLength(rows);
  });

  it('page 3 has the boards, with a tick box per piece row', () => {
    const page = doc.pages[2]!;
    const t = texts(page.items);
    expect(t).toContain('Cut list');
    expect(t.some((s) => s.startsWith('From 2×4 precut studs, 8′ 8 5/8″ — 59 boards'))).toBe(true);
    const rows = poolHouseInput().report.cutList.reduce((s, g) => s + g.pieces.length, 0);
    expect(page.items.filter((i) => i.type === 'tick')).toHaveLength(rows);
  });

  it('prints each cut piece\'s cuts under its length, and the bevelled sheathing on the materials page', () => {
    const cut = texts(doc.pages[2]!.items);
    // Wrapped between the label's parts, never inside a length.
    expect(cut).toContain('long point · plumb 26.6° both ends ·');
    expect(cut).toContain('birdsmouth (seat 3 15/16″, heel 2″)');
    expect(texts(doc.pages[1]!.items).some((s) => /^\d+ × bevel 26\.6° one edge$/.test(s))).toBe(true);
  });

  it('every page has the footer, and nothing runs into the margins', () => {
    doc.pages.forEach((page, i) => {
      const t = texts(page.items);
      expect(t).toContain(`Page ${i + 1} of 3`);
      expect(t).toContain(`Pool house · ${FOOTER_NOTE}`);
      for (const item of page.items) {
        if (item.type !== 'text' || item.rotate) continue;
        expect(item.x, item.text).toBeGreaterThanOrEqual(MARGIN - 1);
        expect(item.x, item.text).toBeLessThanOrEqual(LETTER.width - MARGIN + 1);
        expect(item.y, item.text).toBeLessThanOrEqual(LETTER.height - MARGIN / 2);
      }
    });
  });

  it('a long materials list carries onto more pages, repeating its group header, and the cut list still starts fresh', () => {
    const input = poolHouseInput();
    const long = layoutPdf({ ...input, report: longReport(input.report, 200) });
    const sections = long.pages.map((p) => p.section);
    const materials = sections.filter((s) => s === 'materials').length;
    expect(materials).toBeGreaterThan(2);
    expect(sections).toEqual(['drawings', ...Array<string>(materials).fill('materials'), 'cut-list']);
    for (const page of long.pages.slice(2, 1 + materials)) expect(texts(page.items)).toContain('Walls (continued)');
    expect(texts(long.pages.at(-1)!.items)).toContain('Cut list');
    expect(texts(long.pages.at(-1)!.items)).toContain(`Page ${long.pages.length} of ${long.pages.length}`);
  });

  it('marks a price the person gave with an orange dot', () => {
    const bus = sampleBus();
    expect(bus.execute('set_price', { material: 'spf-no2', size: '2x4', price: 0.5, per: 'linear-ft' }).ok).toBe(true);
    const page = layoutPdf(pdfInput(bus.project, catalog, NOW)).pages[1]!;
    const orange = page.items.filter((i) => i.type === 'circle' && i.fill === '#e8590c');
    // One per user-priced row, plus the legend's.
    expect(orange.length).toBeGreaterThan(1);
    expect(texts(page.items)).toContain('Your own price, in place of the price table.');
  });
});

describe('renderPdf', () => {
  it('with Geist: a 3-page letter PDF', async () => {
    const bytes = await renderPdf(layoutPdf(poolHouseInput()), geist(), { createdOn: NOW });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(3);
    for (const page of loaded.getPages()) expect([page.getWidth(), page.getHeight()]).toEqual([612, 792]);
    expect(loaded.getTitle()).toBe('Pool house: drawings, materials and cut list');
    // For a look in a viewer: SLAPDASH_PDF_OUT=/tmp/pool-house.pdf pnpm --filter @slapdash/web test pdf
    if (process.env.SLAPDASH_PDF_OUT) writeFileSync(process.env.SLAPDASH_PDF_OUT, bytes);
  });

  it('with no font (the Helvetica fallback) it still renders, primes and all', async () => {
    const bytes = await renderPdf(layoutPdf(poolHouseInput()), null);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('falls back to Helvetica when the font bytes are not a font', async () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    const bytes = await renderPdf(layoutPdf(poolHouseInput()), { regular: junk, semibold: junk });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});

describe('sanitizeText', () => {
  it('swaps a glyph the font lacks for an ASCII stand-in', () => {
    const ascii = (cp: number) => cp < 128;
    expect(sanitizeText('8′ 8 5/8″ × 2 – $1', ascii)).toBe('8\' 8 5/8" x 2 - $1');
    expect(sanitizeText('2.75 yd³', ascii)).toBe('2.75 yd3');
    expect(sanitizeText('☃', ascii)).toBe('?');
    expect(sanitizeText('8′ 0″', () => true)).toBe('8′ 0″');
  });
});

describe('the file name', () => {
  it('is the project name as a slug', () => {
    expect(projectSlug('Pool house')).toBe('pool-house');
    expect(projectSlug('  Shed #2 (back) ')).toBe('shed-2-back');
    expect(projectSlug('!!!')).toBe('project');
  });
});
