/**
 * Export PDF (ADR-0003 §K.4): the drawings, the materials list and the cut list as one US
 * letter PDF, downloaded as `<project-slug>.pdf`. This module and pdf-lib load only when
 * Export is clicked, and the Geist font files are fetched only then; if the fetch fails the
 * PDF is set in Helvetica instead.
 */
import type { CatalogIndex, Project } from '@slapdash/core';
import { buildSheet } from '../drawing/sheet.ts';
import { EXPORT_DEFAULTS } from '../drawing/svg.ts';
import { materialsReport } from '../materials/useMaterials.ts';
import { projectSummary } from '../model/floor-stops.ts';
import regularUrl from './fonts/Geist-Regular.ttf?url';
import semiboldUrl from './fonts/Geist-SemiBold.ttf?url';
import { layoutPdf, type PdfInput } from './pdf-layout.ts';
import type { FontBytes } from './pdf-render.ts';

/** `Pool house` → `pool-house`. */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function exportDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function pdfInput(project: Project, catalog: CatalogIndex, now: Date = new Date()): PdfInput {
  return {
    name: project.name,
    specs: projectSummary(project).specs,
    sheet: buildSheet(project, EXPORT_DEFAULTS),
    report: materialsReport(project, catalog),
    exportedOn: exportDate(now),
  };
}

async function loadFonts(): Promise<FontBytes | null> {
  try {
    const [regular, semibold] = await Promise.all(
      [regularUrl, semiboldUrl].map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font ${res.status}`);
        return res.arrayBuffer();
      }),
    );
    return { regular: regular!, semibold: semibold! };
  } catch {
    return null;
  }
}

function download(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Build the PDF, start the download and return the bytes. */
export async function exportProjectPdf(project: Project, catalog: CatalogIndex): Promise<Uint8Array> {
  const doc = layoutPdf(pdfInput(project, catalog));
  const [{ renderPdf }, fonts] = await Promise.all([import('./pdf-render.ts'), loadFonts()]);
  const bytes = await renderPdf(doc, fonts);
  download(bytes, `${projectSlug(project.name)}.pdf`);
  return bytes;
}
