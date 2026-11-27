/**
 * Window and door units. add_opening (and build_wall's inline openings) draw the unit in
 * an opening's O assembly as many parts — frame jambs, head and sill or threshold, sash
 * stiles and rails, glass lites, door slabs, a nailing fin or casing — all in the
 * product's material and tagged `unit`. They are still one unit: one priced item, one
 * selection, one line for Claude. These helpers find and name them from their tags.
 *
 * Projects made before units existed have one `panel` part per opening instead; it isn't
 * a unit part, and keeps working as it did until the opening is edited.
 */
import { formatFeetInches } from '../units/length.ts';
import type { CatalogIndex } from '../catalog/validate.ts';
import type { Part, Project } from './schema.ts';

/** Tag on every part of a window or door unit. */
export const UNIT_TAG = 'unit';

/** The pieces a unit is drawn from, as in its `unit:<piece>` tag. */
export const UNIT_PIECES = [
  'jamb',
  'head',
  'sill',
  'threshold',
  'flange',
  'stile',
  'rail',
  'meeting-rail',
  'mullion',
  'glass',
  'slab',
  'casing',
] as const;
export type UnitPiece = (typeof UNIT_PIECES)[number];

type Tagged = { tags: readonly string[] };

export const isUnitPart = (part: Tagged): boolean => part.tags.includes(UNIT_TAG);

/** The piece a unit part is (`jamb`, `glass`, …), or null for a part that isn't one. */
export function unitPiece(part: Tagged): UnitPiece | null {
  if (!isUnitPart(part)) return null;
  const t = part.tags.find((x) => x.startsWith('unit:'));
  return t ? (t.slice('unit:'.length) as UnitPiece) : null;
}

/** The opening a unit part (or legacy panel) belongs to: its `opening:` tag, else its assembly. */
export function unitOpeningId(part: Tagged & { assemblyId: string }): string {
  const t = part.tags.find((x) => x.startsWith('opening:'));
  return t ? t.slice('opening:'.length) : part.assemblyId;
}

/** A unit part's sash or leaf number (`sash:<n>`), or null. */
export function unitSash(part: Tagged): number | null {
  const t = part.tags.find((x) => x.startsWith('sash:'));
  return t ? Number(t.slice('sash:'.length)) : null;
}

/** The unit parts in opening assembly `openingId`, sorted by ID. */
export function unitPartsOf(project: Project, openingId: string): Part[] {
  return Object.values(project.parts)
    .filter((p) => p.assemblyId === openingId && isUnitPart(p))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A pre-unit window or door: the single `panel` part an opening assembly used to get. */
export function isLegacyOpeningPanel(project: Project, part: Part): boolean {
  return part.role === 'panel' && project.assemblies[part.assemblyId]?.kind === 'opening';
}

const STYLE_WORDS: Record<string, string> = {
  fixed: 'fixed window',
  casement: 'casement window',
  awning: 'awning window',
  'single-hung': 'single-hung window',
  'double-hung': 'double-hung window',
  slider: 'sliding window',
  entry: 'door',
  french: 'French door',
  sliding: 'sliding door',
};

/** "casement window", "French door", from a unit style; the kind when there's no style. */
export function unitStyleWords(style: string | undefined, kind: string): string {
  return (style && STYLE_WORDS[style]) ?? kind.replace('-', ' ');
}

const ftIn = (mm: number) => formatFeetInches(mm).replace(/^(-?)0' /, '$1').replace(/ 0"$/, '');

/**
 * How a unit is named to the person: "Casement window 3' × 4', Window in South wall".
 * Null when `openingId` isn't an opening made by add_opening.
 */
export function unitLabel(project: Project, catalog: CatalogIndex | undefined, openingId: string): string | null {
  const asm = Object.hasOwn(project.assemblies, openingId) ? project.assemblies[openingId] : undefined;
  if (!asm || asm.kind !== 'opening') return null;
  const p = asm.builder?.name === 'add_opening' ? (asm.builder.params as Record<string, unknown>) : null;
  const width = typeof p?.width === 'number' ? p.width : null;
  const height = typeof p?.height === 'number' ? p.height : null;
  const kind = typeof p?.kind === 'string' ? p.kind : 'opening';
  const style = typeof p?.style === 'string' ? p.style : undefined;
  const productId = typeof p?.product === 'string' ? p.product : undefined;
  const product = productId ? catalog?.materials.get(productId) : undefined;
  const what = product?.name ?? unitStyleWords(style, kind);
  const first = what.charAt(0).toUpperCase() + what.slice(1);
  const size = width !== null && height !== null ? ` ${ftIn(width)} × ${ftIn(height)}` : '';
  return `${first}${size}, ${asm.name}`;
}
