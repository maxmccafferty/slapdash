/**
 * Prescriptive framing rules the builders encode. Each table cites its source.
 * These are the US light-frame (IRC) rules for nominal lumber; structural checking
 * beyond them is the solver's job (a later ticket).
 */
import { MM_PER_FOOT, MM_PER_INCH } from '../units/length.ts';

const IN = MM_PER_INCH;
const FT = MM_PER_FOOT;

// ── Stud / joist / rafter spacing ───────────────────────────────────────────

export const SPACINGS = ['12in', '16in', '19.2in', '24in'] as const;
export type SpacingLabel = (typeof SPACINGS)[number];
export const SPACING_MM: Record<SpacingLabel, number> = {
  '12in': 12 * IN,
  '16in': 16 * IN,
  '19.2in': 19.2 * IN,
  '24in': 24 * IN,
};

/** Lumber stock lengths top out at 20ft in the US yards the builders assume. */
export const STOCK_LENGTH_MM = 20 * FT;

// ── Headers: IRC 2021 Table R602.7(1) ───────────────────────────────────────
//
// IRC 2021 Table R602.7(1) "Girder spans and header spans for exterior bearing walls",
// rows "Roof and ceiling" (headers carrying a roof and ceiling only), for
// Douglas fir-larch, hem-fir, southern pine and spruce-pine-fir No. 2. Each cell is
// span (feet-inches) / NJ, where NJ is the number of jack studs needed at each end.
// Building widths are 12, 24 and 36 ft; ground snow 30, 50 and 70 psf.
// Transcribed from the 2021 table as reproduced by joistspan.com/headers and
// cross-checked (30 psf) against reuven.tools and smartroofingcalculator.com
// header-span charts; all three agree.

export const HEADER_SNOW_PSF = [30, 50, 70] as const;
export const HEADER_BUILDING_WIDTH_FT = [12, 24, 36] as const;
export type HeaderSnow = (typeof HEADER_SNOW_PSF)[number];

/** Section ids from shallowest to deepest (used to order the choices). */
export const HEADER_SECTIONS = ['2x4', '2x6', '2x8', '2x10', '2x12'] as const;
export type HeaderSection = (typeof HEADER_SECTIONS)[number];

type Cells = readonly [string, string, string];
const RAW: Record<HeaderSnow, Record<string, Cells>> = {
  30: {
    '1-2x6': ['4-0/1', '3-1/2', '2-7/2'],
    '1-2x8': ['5-1/2', '3-11/2', '3-3/2'],
    '1-2x10': ['6-0/2', '4-8/2', '3-11/2'],
    '1-2x12': ['7-1/2', '5-5/2', '4-7/3'],
    '2-2x4': ['4-0/1', '3-1/1', '2-7/1'],
    '2-2x6': ['6-0/1', '4-7/1', '3-10/1'],
    '2-2x8': ['7-7/1', '5-9/1', '4-10/2'],
    '2-2x10': ['9-0/1', '6-10/2', '5-9/2'],
    '2-2x12': ['10-7/2', '8-1/2', '6-10/2'],
    '3-2x8': ['9-5/1', '7-3/1', '6-1/1'],
    '3-2x10': ['11-3/1', '8-7/1', '7-3/2'],
    '3-2x12': ['13-2/1', '10-1/2', '8-6/2'],
    '4-2x8': ['10-11/1', '8-4/1', '7-0/1'],
    '4-2x10': ['12-11/1', '9-11/1', '8-4/1'],
    '4-2x12': ['15-3/1', '11-8/1', '9-10/2'],
  },
  50: {
    '1-2x6': ['3-5/1', '2-8/2', '2-3/2'],
    '1-2x8': ['4-4/2', '3-4/2', '2-10/2'],
    '1-2x10': ['5-2/2', '4-0/2', '3-4/3'],
    '1-2x12': ['6-1/2', '4-8/3', '3-11/3'],
    '2-2x4': ['3-5/1', '2-7/1', '2-2/1'],
    '2-2x6': ['5-1/1', '3-11/1', '3-3/2'],
    '2-2x8': ['6-5/1', '5-0/2', '4-2/2'],
    '2-2x10': ['7-8/2', '5-11/2', '4-11/2'],
    '2-2x12': ['9-0/2', '6-11/2', '5-10/2'],
    '3-2x8': ['8-1/1', '6-3/1', '5-3/2'],
    '3-2x10': ['9-7/1', '7-4/2', '6-2/2'],
    '3-2x12': ['11-3/2', '8-8/2', '7-4/2'],
    '4-2x8': ['9-4/1', '7-2/1', '6-0/1'],
    '4-2x10': ['11-1/1', '8-6/1', '7-2/2'],
    '4-2x12': ['13-0/1', '10-0/2', '8-5/2'],
  },
  70: {
    '1-2x6': ['3-0/2', '2-4/2', '2-0/2'],
    '1-2x8': ['3-10/2', '3-0/2', '2-6/3'],
    '1-2x10': ['4-7/2', '3-6/3', '3-0/3'],
    '1-2x12': ['5-5/2', '4-2/3', '3-6/3'],
    '2-2x4': ['3-0/1', '2-4/1', '2-0/1'],
    '2-2x6': ['4-6/1', '3-6/2', '2-11/2'],
    '2-2x8': ['5-9/1', '4-5/2', '3-9/2'],
    '2-2x10': ['6-9/2', '5-3/2', '4-5/2'],
    '2-2x12': ['8-0/2', '6-2/2', '5-2/3'],
    '3-2x8': ['7-2/1', '5-6/2', '4-8/2'],
    '3-2x10': ['8-6/1', '6-7/2', '5-6/2'],
    '3-2x12': ['10-0/2', '7-9/2', '6-6/2'],
    '4-2x8': ['8-3/1', '6-4/1', '5-4/2'],
    '4-2x10': ['9-10/1', '7-7/2', '6-4/2'],
    '4-2x12': ['11-7/1', '8-11/2', '7-6/2'],
  },
};

export interface HeaderRow {
  plies: number;
  sectionId: HeaderSection;
  /** Max span in mm for building widths 12, 24, 36 ft. */
  spans: readonly [number, number, number];
  /** Jack studs needed at each end, for building widths 12, 24, 36 ft. */
  jacks: readonly [number, number, number];
}

function parseCell(cell: string): { span: number; nj: number } {
  const m = /^(\d+)-(\d+)\/(\d)$/.exec(cell);
  if (!m) throw new Error(`bad header cell ${cell}`);
  return { span: Number(m[1]) * FT + Number(m[2]) * IN, nj: Number(m[3]) };
}

const depthRank = (s: HeaderSection) => HEADER_SECTIONS.indexOf(s);

/** IRC 2021 Table R602.7(1), roof-and-ceiling rows, keyed by ground snow load (psf). */
export const HEADER_TABLE: Record<HeaderSnow, readonly HeaderRow[]> = Object.fromEntries(
  HEADER_SNOW_PSF.map((snow) => {
    const rows = Object.entries(RAW[snow]).map(([key, cells]): HeaderRow => {
      const [plies, section] = key.split('-2x');
      const parsed = cells.map(parseCell);
      return {
        plies: Number(plies),
        sectionId: `2x${section}` as HeaderSection,
        spans: [parsed[0]!.span, parsed[1]!.span, parsed[2]!.span],
        jacks: [parsed[0]!.nj, parsed[1]!.nj, parsed[2]!.nj],
      };
    });
    rows.sort((a, b) => depthRank(a.sectionId) - depthRank(b.sectionId) || a.plies - b.plies);
    return [snow, rows];
  }),
) as unknown as Record<HeaderSnow, readonly HeaderRow[]>;

export interface HeaderQuery {
  /** Clear span (rough-opening width), mm. */
  spanMm: number;
  /** Ground snow load, psf. Values under 30 use the 30 psf rows. */
  snowPsf: number;
  /** Building width, ft. Values between columns use the next wider column. */
  buildingWidthFt: number;
  /** Most plies that fit in the wall (a 2x4 wall takes 2, a 2x6 wall 3). */
  maxPlies?: number;
}

export interface HeaderChoice {
  plies: number;
  sectionId: HeaderSection;
  /** Jack studs at each end. */
  jacks: number;
  maxSpanMm: number;
  /** Table column used. */
  snowPsf: HeaderSnow;
  buildingWidthFt: (typeof HEADER_BUILDING_WIDTH_FT)[number];
}

/** The snow column used for a ground snow load, or null past the table (over 70 psf). */
export function headerSnowColumn(snowPsf: number): HeaderSnow | null {
  return HEADER_SNOW_PSF.find((s) => snowPsf <= s + 1e-9) ?? null;
}

/** The width column used for a building width, or null past the table (over 36 ft). */
export function headerWidthColumn(widthFt: number): (typeof HEADER_BUILDING_WIDTH_FT)[number] | null {
  return HEADER_BUILDING_WIDTH_FT.find((w) => widthFt <= w + 1e-9) ?? null;
}

function rowsFor(q: HeaderQuery) {
  const snow = headerSnowColumn(q.snowPsf);
  const width = headerWidthColumn(q.buildingWidthFt);
  if (snow === null || width === null) return null;
  const col = HEADER_BUILDING_WIDTH_FT.indexOf(width);
  const rows = HEADER_TABLE[snow].filter((r) => r.plies <= (q.maxPlies ?? Infinity));
  return { snow, width, col, rows };
}

/**
 * The smallest header (shallowest section, then fewest plies) whose table span is at
 * least the opening, or null if none fits (or the inputs are past the table).
 */
export function pickHeader(q: HeaderQuery): HeaderChoice | null {
  const t = rowsFor(q);
  if (!t) return null;
  const row = t.rows.find((r) => r.spans[t.col]! >= q.spanMm - 1e-6);
  if (!row) return null;
  return {
    plies: row.plies,
    sectionId: row.sectionId,
    jacks: row.jacks[t.col]!,
    maxSpanMm: row.spans[t.col]!,
    snowPsf: t.snow,
    buildingWidthFt: t.width,
  };
}

/** The longest-spanning header available for the query's column and ply limit (for refusals). */
export function largestHeader(q: Omit<HeaderQuery, 'spanMm'>): HeaderChoice | null {
  const t = rowsFor({ ...q, spanMm: 0 });
  if (!t || t.rows.length === 0) return null;
  const row = t.rows.reduce((best, r) => (r.spans[t.col]! > best.spans[t.col]! ? r : best));
  return {
    plies: row.plies,
    sectionId: row.sectionId,
    jacks: row.jacks[t.col]!,
    maxSpanMm: row.spans[t.col]!,
    snowPsf: t.snow,
    buildingWidthFt: t.width,
  };
}

/**
 * IRC R602.7.4: in a non-bearing wall a single flat 2x4 may be the header for an
 * opening up to 8 ft wide (when the nailing surface above is within 24 in).
 */
export const NONBEARING_FLAT_HEADER_MAX_SPAN_MM = 8 * FT;

// ── King studs: IRC Table R602.7.5 ──────────────────────────────────────────
//
// IRC Table R602.7.5 "Minimum number of full-height studs at each end of headers in
// exterior walls", column "< 140 mph, Exposure B or < 130 mph, Exposure C" (the more
// demanding column, used here because the builders don't know the wind exposure).
// Footnote a: for spans between those listed, use the larger span's row.
// Transcribed from the table as reproduced in the 2025 California Residential Code
// (which adopts the IRC table); check against the 2021 IRC text when the tier-1
// catalog lands.
export const KING_STUD_TABLE: ReadonlyArray<{ maxSpanFt: number; kings: number }> = [
  { maxSpanFt: 4, kings: 1 },
  { maxSpanFt: 6, kings: 2 },
  { maxSpanFt: 8, kings: 2 },
  { maxSpanFt: 10, kings: 3 },
  { maxSpanFt: 12, kings: 3 },
  { maxSpanFt: 14, kings: 3 },
  { maxSpanFt: 16, kings: 4 },
  { maxSpanFt: 18, kings: 4 },
];

/** King (full-height) studs at each end of a header of this span, or null past 18 ft. */
export function kingStudsFor(spanMm: number): number | null {
  const row = KING_STUD_TABLE.find((r) => spanMm <= r.maxSpanFt * FT + 1e-6);
  return row ? row.kings : null;
}

// ── Anchor bolts: IRC R403.1.6 ──────────────────────────────────────────────
//
// IRC R403.1.6: 1/2 in anchor bolts embedded 7 in, at most 6 ft apart, one within
// 12 in of each end of each plate section, and at least two per plate section.
export const ANCHOR_BOLT_MAX_SPACING_MM = 6 * FT;
export const ANCHOR_BOLT_END_DISTANCE_MM = 12 * IN;

export function anchorBoltCount(plateLengthMm: number): number {
  const between = plateLengthMm - 2 * ANCHOR_BOLT_END_DISTANCE_MM;
  if (between <= 0) return 2;
  return Math.max(2, Math.ceil(between / ANCHOR_BOLT_MAX_SPACING_MM - 1e-9) + 1);
}

// ── Nailing: IRC 2021 Table R602.3(1) (simplified) ──────────────────────────
//
// Wood structural panel sheathing to framing: 8d nails at 6 in on panel edges and
// 12 in in the field. Framing-to-framing joints use 16d nails: 2 end-nails at a
// stud/plate, and face-nailing along longer contacts (top plate to top plate etc.)
// simplified here to one nail per 24 in, at least 2.
export const SHEATHING_EDGE_NAIL_MM = 6 * IN;
export const SHEATHING_FIELD_NAIL_MM = 12 * IN;
export const FACE_NAIL_SPACING_MM = 24 * IN;

export function sheathingNailCount(lengthMm: number, edge: boolean): number {
  const spacing = edge ? SHEATHING_EDGE_NAIL_MM : SHEATHING_FIELD_NAIL_MM;
  return Math.max(1, Math.ceil(lengthMm / spacing - 1e-9));
}

export function framingNailCount(contactLengthMm: number): number {
  return Math.max(2, Math.ceil(contactLengthMm / FACE_NAIL_SPACING_MM - 1e-9));
}

/** Joist end-nailed through a rim: 3-16d (R602.3(1), rim to joist). */
export const JOIST_TO_RIM_NAILS = 3;
/** Rafter to ridge, and rafter toe-nailed to plate: 3-16d (R602.3(1)). */
export const RAFTER_NAILS = 3;
/** Rafter tie / ceiling joist heel joint (R802.5.2(1) simplified to 4-16d). */
export const HEEL_JOINT_NAILS = 4;

// ── Roofs ───────────────────────────────────────────────────────────────────

/** Rise per 12 the roof builder accepts. */
export const MIN_PITCH_RISE = 1;
export const MAX_PITCH_RISE = 24;
/** Ridge board one size deeper than the rafters. */
export const RIDGE_FOR_RAFTER: Record<string, string> = { '2x6': '2x8', '2x8': '2x10', '2x10': '2x12' };

// ── Fences ──────────────────────────────────────────────────────────────────

export const FENCE_MAX_POST_SPACING_MM = 8 * FT;
export const FENCE_MAX_HEIGHT_MM = 8 * FT;
