/**
 * The materials takeoff (ADR-0003 §F, ADR-0001 §11): one computation gives the materials
 * list by build step, the cut list and the cost totals, so the two tabs and the PDF always
 * agree.
 *
 * - Lumber, engineered wood and steel with stock lengths are bought as boards: the
 *   optimizer packs each (step, material, section)'s pieces into stock, and the list counts
 *   boards per stock length. Without stock, they are bought by the linear foot.
 * - Sheet goods: one sheet per piece (builders lay panels on the 4×8 grid). Cut panels
 *   (the bevelled ridge row of a roof) are listed in the row's `details`.
 * - Cut parts (`Part.cuts`) are packed by their long-point length (`size.length`) plus
 *   kerf, and their cut-list rows carry the cut angles, so pieces of one length with
 *   different cuts get separate rows.
 * - Concrete: the volume, rounded up to the next 1/4 yd³.
 * - Hardware comes from the joints (`hardwareId`, one per fastener or per joint) and goes
 *   with the later of its two parts' steps.
 * - Masonry units, window and door units and loose hardware are counted as pieces, unless
 *   they are priced by area or length (pavers, veneer, glass panels), like coverings.
 * - Anything else is measured in the unit it is priced in.
 *
 * Money is summed in cents; rounding to dollars is for display.
 */
import type { PriceTable, PriceUnit } from '../catalog/prices.ts';
import type { Catalog, Material, MaterialCategory, Section, StockLength, Swatch } from '../catalog/schema.ts';
import { indexCatalog, isCatalogIndex, type CatalogIndex } from '../catalog/validate.ts';
import { describeCuts, hasCuts, type CutDescription } from '../geometry/cuts.ts';
import type { Part, PartCuts, Project } from '../model/schema.ts';
import { MM_PER_FOOT, MM_PER_INCH } from '../units/length.ts';
import { cutStock, type Board, type CutOptions, type CutPiece } from './optimizer.ts';
import { SHEET_FT2, hasVariants, resolvePrice, sheetVariant, tableUnit, userPriceFor } from './price.ts';
import { STEP_KEYS, STEP_TITLES, buildStepGroups, isBuiltPart, stepOfJoint, stepOfPart, type StepKey } from './steps.ts';

const FT2_MM2 = MM_PER_FOOT * MM_PER_FOOT;
const YD3_MM3 = (3 * MM_PER_FOOT) ** 3;

/** How a row is counted. */
export type RowMeasure = 'boards' | 'linear-ft' | 'sheets' | 'cu-yd' | 'pieces' | 'sq-ft' | 'fasteners';

export interface RowCost {
  /** The price of one `unit`, low and high (equal when it is the person's own price). */
  unitLow_usd: number;
  unitHigh_usd: number;
  unit: PriceUnit;
  low_cents: number;
  high_cents: number;
  /** The person's own price (shown with an orange dot). */
  user: boolean;
}

export interface MaterialsRow {
  /** Unique in the report: `<step>:<kind>|<material>|<size>…`. */
  id: string;
  step: StepKey;
  /** Absent for a joint's fastener that isn't a catalog item. */
  materialId?: string;
  name: string;
  category?: MaterialCategory;
  swatch?: Swatch;
  sectionId?: string;
  /** The section as sold, e.g. "2x4". */
  nominal?: string;
  /** Price-table size: section id, sheet thickness or hardware size. */
  variant?: string;
  measure: RowMeasure;
  /** Boards, linear feet, sheets, cubic yards, pieces, square feet or fasteners. */
  quantity: number;
  /** The stock length, for board rows. */
  stock?: StockLength;
  partIds: string[];
  jointIds: string[];
  cost: RowCost | null;
  /** Why there is no price ("pick a specific window or door"); set when `cost` is null. */
  noPriceReason?: string;
  /** Extra lines for the row, e.g. "6 × bevel 26.6° one edge" for cut sheets. */
  details?: string[];
}

export interface MaterialsGroup {
  step: StepKey;
  title: string;
  rows: MaterialsRow[];
  low_cents: number;
  high_cents: number;
  /** Rows with no price. */
  unpriced: number;
}

/** One row of the cut list: pieces of one length cut from a group's boards. */
export interface CutRow {
  length_mm: number;
  count: number;
  /** Segments of a part longer than the longest stock, joined on site. */
  spliced: boolean;
  /** The parts cut (a spliced part appears once per segment). */
  pieceIds: string[];
  /** The cuts on every piece of the row (from the first; they all share them). */
  cuts?: CutDescription;
}

export interface CutListGroup {
  /** `<material>|<section>|<stock mm>`. */
  id: string;
  materialId: string;
  materialName: string;
  swatch?: Swatch;
  sectionId: string;
  nominal: string;
  stock: StockLength;
  /** Boards of this stock length, over every step. */
  boards: number;
  /** Piece lengths, longest first. */
  pieces: CutRow[];
  steps: StepKey[];
}

export interface MaterialsTotals {
  low_cents: number;
  high_cents: number;
  /** Rows with no price. */
  unpriced: number;
  /** The price table's date (YYYY-MM-DD), shown with every cost. */
  researchedOn: string;
  /** The price table's caveat, e.g. "Planning estimates, not quotes." */
  note: string;
  region: string;
  /** Some row uses the person's own price. */
  hasUserPrices: boolean;
}

export interface MaterialsReport {
  groups: MaterialsGroup[];
  cutList: CutListGroup[];
  totals: MaterialsTotals;
  isEmpty: boolean;
}

export type TakeoffOptions = CutOptions;

type Kind = 'board' | 'length' | 'sheet' | 'concrete' | 'pieces' | 'area' | 'hardware';
const KIND_ORDER: Record<Kind, number> = { concrete: 0, board: 1, length: 1, sheet: 2, area: 3, pieces: 4, hardware: 5 };
const MEMBER_CATEGORIES = new Set<MaterialCategory>(['lumber', 'engineered-wood', 'steel']);

interface Bucket {
  kind: Kind;
  step: StepKey;
  key: string;
  material?: Material;
  name: string;
  section?: Section;
  variant?: string;
  unit: PriceUnit;
  measure: RowMeasure;
  quantity: number;
  stock?: StockLength;
  partIds: string[];
  jointIds: string[];
  noPrice?: string;
  /** Cut labels on the bucket's parts, with counts. */
  cutLabels?: Map<string, number>;
}

const twoLargest = (p: Part) => {
  const d = [p.size.length, p.size.width, p.size.height].map(Math.abs).sort((a, b) => b - a);
  return { a: d[0]!, b: d[1]!, thickness: d[2]! };
};

const MEASURE_OF: Record<PriceUnit, { kind: Kind; measure: RowMeasure }> = {
  'sq-ft': { kind: 'area', measure: 'sq-ft' },
  'linear-ft': { kind: 'length', measure: 'linear-ft' },
  sheet: { kind: 'sheet', measure: 'sheets' },
  'cu-yd': { kind: 'concrete', measure: 'cu-yd' },
  each: { kind: 'pieces', measure: 'pieces' },
  lb: { kind: 'pieces', measure: 'pieces' },
};

/** The unit a part of this material is priced in: the person's own price first, then the table's, else each. */
function pricedUnit(project: Project, table: PriceTable, material: Material, section: Section | undefined): PriceUnit {
  return userPriceFor(project, material.id, section?.id)?.per ?? tableUnit(table, material.priceKey) ?? 'each';
}

function cents(usd: number): number {
  return Math.round(usd * 100);
}

/** Materials list, cut list and totals for a project, priced from `table` and the project's own prices. */
export function takeoff(project: Project, catalog: Catalog | CatalogIndex, table: PriceTable, opts: TakeoffOptions = {}): MaterialsReport {
  const idx = isCatalogIndex(catalog) ? catalog : indexCatalog(catalog);
  const stepGroups = buildStepGroups(project, idx);
  const order: StepKey[] = [...stepGroups.map((g) => g.step), ...STEP_KEYS.filter((k) => !stepGroups.some((g) => g.step === k))];
  const sectionOrder = new Map([...idx.sections.keys()].map((id, i) => [id, i]));

  const buckets = new Map<string, Bucket>();
  const bucket = (b: Omit<Bucket, 'quantity' | 'partIds' | 'jointIds'>): Bucket => {
    const id = `${b.step}:${b.key}`;
    let out = buckets.get(id);
    if (!out) {
      out = { ...b, quantity: 0, partIds: [], jointIds: [] };
      buckets.set(id, out);
    }
    return out;
  };

  // Members with stock: pieces per (step, material, section), packed below.
  const toCut = new Map<string, { step: StepKey; material: Material; section: Section; pieces: CutPiece[] }>();

  const parts = Object.values(project.parts)
    .filter((p) => isBuiltPart(p, idx))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const part of parts) {
    const step = stepOfPart(project, part);
    const material = idx.materials.get(part.materialId);
    const section = part.sectionId ? idx.sections.get(part.sectionId) : undefined;
    const name = material?.name ?? part.materialId;
    const category = material?.category;
    if (!material) {
      const b = bucket({ kind: 'pieces', step, key: `pieces|${part.materialId}`, name, unit: 'each', measure: 'pieces', noPrice: "it isn't in the catalog" });
      b.quantity++;
      b.partIds.push(part.id);
      continue;
    }
    const base = { step, material, name };
    if (category === 'concrete') {
      const b = bucket({ ...base, kind: 'concrete', key: `concrete|${material.id}`, unit: 'cu-yd', measure: 'cu-yd' });
      b.quantity += Math.abs(part.size.length * part.size.width * part.size.height) / YD3_MM3;
      b.partIds.push(part.id);
    } else if (category === 'sheet' || section?.shape === 'sheet') {
      const { a, b: w, thickness } = twoLargest(part);
      const variant = sheetVariant(thickness);
      const b = bucket({ ...base, kind: 'sheet', key: `sheet|${material.id}|${variant}`, variant, unit: 'sheet', measure: 'sheets' });
      b.quantity += Math.max(1, Math.ceil((a * w) / FT2_MM2 / SHEET_FT2 - 0.01));
      b.partIds.push(part.id);
      if (hasCuts(part)) {
        const label = describeCuts(part).label;
        b.cutLabels ??= new Map();
        b.cutLabels.set(label, (b.cutLabels.get(label) ?? 0) + 1);
      }
    } else if (category !== undefined && MEMBER_CATEGORIES.has(category) && section) {
      if (section.stock && section.stock.length > 0) {
        const key = `${step}|${material.id}|${section.id}`;
        let c = toCut.get(key);
        if (!c) {
          c = { step, material, section, pieces: [] };
          toCut.set(key, c);
        }
        c.pieces.push({ id: part.id, length_mm: Math.abs(part.size.length) });
      } else {
        const b = bucket({ ...base, kind: 'length', key: `length|${material.id}|${section.id}`, section, variant: section.id, unit: 'linear-ft', measure: 'linear-ft' });
        b.quantity += Math.abs(part.size.length) / MM_PER_FOOT;
        b.partIds.push(part.id);
      }
    } else if (
      category !== undefined &&
      (MEMBER_CATEGORIES.has(category) ||
        ((category === 'masonry' || category === 'opening' || category === 'fastener') && pricedUnit(project, table, material, section) === 'each'))
    ) {
      // Members without a section, masonry units, window and door units, loose hardware.
      // Masonry, openings and hardware priced by area or length (pavers, veneer, glass)
      // fall through to the coverings branch below.
      const unit: PriceUnit = MEMBER_CATEGORIES.has(category) ? 'linear-ft' : 'each';
      const m = MEASURE_OF[unit];
      const variant = section?.id;
      const b = bucket({ ...base, ...m, key: `${m.kind}|${material.id}|${variant ?? ''}`, ...(section ? { section } : {}), ...(variant ? { variant } : {}), unit });
      b.quantity += unit === 'linear-ft' ? Math.abs(part.size.length) / MM_PER_FOOT : 1;
      b.partIds.push(part.id);
    } else {
      // Coverings and the rest: measured in the unit they are priced in.
      const variant = section?.id;
      const unit = pricedUnit(project, table, material, section);
      const m = MEASURE_OF[unit];
      const b = bucket({ ...base, ...m, key: `${m.kind}|${material.id}|${variant ?? ''}`, ...(section ? { section } : {}), ...(variant ? { variant } : {}), unit });
      const { a, b: w } = twoLargest(part);
      b.quantity +=
        m.kind === 'area'
          ? (a * w) / FT2_MM2
          : m.kind === 'length'
            ? Math.abs(part.size.length) / MM_PER_FOOT
            : m.kind === 'concrete'
              ? Math.abs(part.size.length * part.size.width * part.size.height) / YD3_MM3
              : m.kind === 'sheet'
                ? Math.max(1, Math.ceil((a * w) / FT2_MM2 / SHEET_FT2 - 0.01))
                : 1;
      b.partIds.push(part.id);
    }
  }

  // Pack the members and turn the boards into rows and cut-list groups.
  const cutGroups = new Map<string, CutListGroup & { firstStep: number; boardList: Board[] }>();
  for (const c of toCut.values()) {
    const boards = cutStock(c.pieces, c.section.stock!, opts);
    for (const board of boards) {
      const len = board.stock.length_mm;
      const b = bucket({
        kind: 'board',
        step: c.step,
        key: `board|${c.material.id}|${c.section.id}|${len}`,
        material: c.material,
        name: c.material.name,
        section: c.section,
        variant: c.section.id,
        unit: 'linear-ft',
        measure: 'boards',
        stock: board.stock,
      });
      b.quantity++;
      for (const p of board.pieces) if (!b.partIds.includes(p.id)) b.partIds.push(p.id);

      const gid = `${c.material.id}|${c.section.id}|${len}`;
      let g = cutGroups.get(gid);
      if (!g) {
        g = {
          id: gid,
          materialId: c.material.id,
          materialName: c.material.name,
          ...(c.material.swatch ? { swatch: c.material.swatch } : {}),
          sectionId: c.section.id,
          nominal: c.section.nominal ?? c.section.name,
          stock: board.stock,
          boards: 0,
          pieces: [],
          steps: [],
          firstStep: order.indexOf(c.step),
          boardList: [],
        };
        cutGroups.set(gid, g);
      }
      g.boards++;
      g.boardList.push(board);
      if (!g.steps.includes(c.step)) g.steps.push(c.step);
      g.firstStep = Math.min(g.firstStep, order.indexOf(c.step));
    }
  }

  // Hardware from the joints.
  const joints = Object.values(project.joints).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const joint of joints) {
    const type = idx.jointTypes.get(joint.jointTypeId);
    if (!type || (type.hardwareId === undefined && type.fastener === undefined)) continue;
    const step = stepOfJoint(project, joint, order, idx);
    if (step === null) continue;
    const n = type.capacity.basis === 'per-fastener' ? joint.fastenerCount : 1;
    const hw = type.hardwareId ? idx.materials.get(type.hardwareId) : undefined;
    let b: Bucket;
    if (hw) {
      let variant: string | undefined;
      if (hw.priceKey && hasVariants(table, hw.priceKey)) {
        variant = joint.partIds.map((id) => project.parts[id]?.sectionId).find((s) => s !== undefined);
      }
      b = bucket({
        kind: 'hardware',
        step,
        key: `hardware|${hw.id}|${variant ?? ''}`,
        material: hw,
        name: hw.name,
        ...(variant ? { variant } : {}),
        unit: 'each',
        measure: 'fasteners',
      });
    } else {
      const label = type.fastener ?? type.name;
      b = bucket({ kind: 'hardware', step, key: `hardware-text|${label}`, name: label, unit: 'each', measure: 'fasteners', noPrice: "it isn't in the catalog" });
    }
    b.quantity += n;
    b.jointIds.push(joint.id);
  }

  // Price the rows.
  const rows: MaterialsRow[] = [];
  for (const [id, b] of buckets) {
    let quantity = b.quantity;
    if (b.kind === 'concrete') quantity = Math.ceil(quantity * 4 - 1e-9) / 4;
    const row: MaterialsRow = {
      id,
      step: b.step,
      name: b.name,
      measure: b.measure,
      quantity,
      partIds: b.partIds,
      jointIds: b.jointIds,
      cost: null,
    };
    if (b.material) {
      row.materialId = b.material.id;
      row.category = b.material.category;
      if (b.material.swatch) row.swatch = b.material.swatch;
    }
    if (b.section) {
      row.sectionId = b.section.id;
      row.nominal = b.section.nominal ?? b.section.name;
    }
    if (b.variant !== undefined) row.variant = b.variant;
    if (b.stock) row.stock = b.stock;
    if (b.cutLabels) row.details = [...b.cutLabels].map(([label, n]) => `${n} × ${label}`);

    if (b.noPrice !== undefined || !b.material) {
      row.noPriceReason = b.noPrice ?? "it isn't in the catalog";
    } else {
      const price = resolvePrice(b.material, b.variant, b.unit, table, project);
      if (!price.ok) {
        row.noPriceReason = price.reason;
      } else {
        // Boards are bought whole: price the board's full length.
        const units = b.kind === 'board' ? (quantity * b.stock!.length_mm) / MM_PER_FOOT : quantity;
        row.cost = {
          unitLow_usd: price.low_usd,
          unitHigh_usd: price.high_usd,
          unit: price.unit,
          low_cents: cents(units * price.low_usd),
          high_cents: cents(units * price.high_usd),
          user: price.user,
        };
      }
    }
    rows.push(row);
  }

  const kindOf = (r: MaterialsRow) => buckets.get(r.id)!.kind;
  rows.sort((a, b) => {
    const ka = KIND_ORDER[kindOf(a)];
    const kb = KIND_ORDER[kindOf(b)];
    if (ka !== kb) return ka - kb;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    const sa = sectionOrder.get(a.sectionId ?? '') ?? -1;
    const sb = sectionOrder.get(b.sectionId ?? '') ?? -1;
    if (sa !== sb) return sa - sb;
    if ((a.variant ?? '') !== (b.variant ?? '')) return (a.variant ?? '') < (b.variant ?? '') ? -1 : 1;
    return (b.stock?.length_mm ?? 0) - (a.stock?.length_mm ?? 0);
  });

  const groups: MaterialsGroup[] = [];
  for (const step of order) {
    const stepRows = rows.filter((r) => r.step === step);
    if (stepRows.length === 0) continue;
    groups.push({
      step,
      title: STEP_TITLES[step],
      rows: stepRows,
      low_cents: stepRows.reduce((s, r) => s + (r.cost?.low_cents ?? 0), 0),
      high_cents: stepRows.reduce((s, r) => s + (r.cost?.high_cents ?? 0), 0),
      unpriced: stepRows.filter((r) => r.cost === null).length,
    });
  }

  const cutList: CutListGroup[] = [...cutGroups.values()]
    .sort(
      (a, b) =>
        a.firstStep - b.firstStep ||
        (a.materialName < b.materialName ? -1 : a.materialName > b.materialName ? 1 : 0) ||
        (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0) ||
        b.stock.length_mm - a.stock.length_mm,
    )
    .map(({ firstStep: _f, boardList, ...g }) => ({ ...g, pieces: cutRowsOf(boardList, project.parts) }));

  return {
    groups,
    cutList,
    totals: {
      low_cents: groups.reduce((s, g) => s + g.low_cents, 0),
      high_cents: groups.reduce((s, g) => s + g.high_cents, 0),
      unpriced: groups.reduce((s, g) => s + g.unpriced, 0),
      researchedOn: table.researchedOn,
      note: table.note,
      region: table.region,
      hasUserPrices: rows.some((r) => r.cost?.user === true),
    },
    isEmpty: rows.length === 0,
  };
}

/**
 * The cuts on one segment of a spliced part: the start cut on the first, the end cut on the
 * last, and the notches whose x range falls on it (shifted to the segment's own x).
 */
function segmentCuts(part: Part, index: number, of: number): { size: Part['size']; cuts?: PartCuts } {
  // `index` is 1-based, as the optimizer numbers segments.
  const k = index - 1;
  const seg = part.size.length / of;
  const size = { ...part.size, length: seg };
  const c = part.cuts;
  if (!c) return { size };
  const x0 = k * seg;
  const out: PartCuts = {};
  if (k === 0 && c.start) out.start = c.start;
  if (k === of - 1 && c.end) out.end = c.end;
  if (c.nearEdge) out.nearEdge = c.nearEdge;
  if (c.farEdge) out.farEdge = c.farEdge;
  const all = describeCuts(part).notches;
  const notches = (c.notches ?? [])
    .filter((_, i) => all[i]!.x1_mm > x0 && all[i]!.x0_mm < x0 + seg)
    .map((n) => ({ ...n, profile: n.profile.map((q) => ({ x: q.x - x0, z: q.z })) }));
  if (notches.length > 0) out.notches = notches;
  return { size, cuts: out };
}

/**
 * The pieces cut from some boards, one row per length (to 1/16in), splice and cuts, longest
 * first. Rows of cut pieces carry the cut description.
 */
function cutRowsOf(boards: readonly Board[], parts: Project['parts']): CutRow[] {
  const byKey = new Map<string, CutRow>();
  for (const board of boards) {
    for (const piece of board.pieces) {
      const spliced = piece.spliced !== undefined;
      const part = parts[piece.id];
      let cuts: CutDescription | undefined;
      if (part && hasCuts(part)) {
        cuts = piece.spliced ? describeCuts(segmentCuts(part, piece.spliced.index, piece.spliced.of)) : describeCuts(part);
        if (cuts.label === '') cuts = undefined;
      }
      const key = `${Math.round((piece.length_mm / MM_PER_INCH) * 16)}|${spliced}|${cuts?.label ?? ''}`;
      let row = byKey.get(key);
      if (!row) {
        row = { length_mm: piece.length_mm, count: 0, spliced, pieceIds: [] };
        if (cuts) row.cuts = cuts;
        byKey.set(key, row);
      }
      row.count++;
      row.pieceIds.push(piece.id);
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.length_mm - a.length_mm ||
      Number(a.spliced) - Number(b.spliced) ||
      ((a.cuts?.label ?? '') < (b.cuts?.label ?? '') ? -1 : (a.cuts?.label ?? '') > (b.cuts?.label ?? '') ? 1 : 0),
  );
}
