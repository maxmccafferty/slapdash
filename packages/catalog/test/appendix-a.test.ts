/**
 * ADR-0001 Appendix A, tier 1 ("enough to build a pool-house shell"), made executable:
 * each item, in the ADR's words, maps to the catalog ids that satisfy it.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/index.ts';

const TIER1: Record<string, Record<string, string[]>> = {
  Lumber: {
    'dimensional: SPF': ['spf-no2'],
    'dimensional: Douglas fir': ['df-l-no2'],
    'dimensional: Southern yellow pine': ['syp-no2'],
    'pressure-treated': ['pt-spf-no2', 'pt-syp-no2-gc'],
    cedar: ['cedar-wrc'],
    redwood: ['redwood-construction'],
  },
  'Engineered wood': {
    LVL: ['lvl-2-0e'],
    'glulam beams': ['glulam-24f-v4'],
    'I-joists': ['i-joist'],
  },
  'Sheet goods': {
    plywood: ['plywood-cdx'],
    OSB: ['osb-7-16', 'osb-23-32'],
  },
  'Concrete and masonry': {
    'poured footings and slabs': ['concrete-3000', 'concrete-4000'],
    'piers/sonotubes': ['sonotube-form'],
    'concrete block (CMU)': ['cmu-standard'],
    rebar: ['rebar-gr60'],
    'gravel base': ['gravel-base'],
  },
  'Fasteners and hardware': {
    nails: ['nail-8d-common', 'nail-10d-common', 'nail-16d-common', 'nail-roofing'],
    'structural and deck screws': ['screw-structural', 'screw-deck'],
    // Not named in the ADR, but the metal roofing it lists needs them.
    'screws (for corrugated and standing-seam metal roofing)': ['screw-metal-roofing'],
    bolts: ['bolt-1-2', 'anchor-bolt-1-2'],
    lags: ['lag-3-8'],
    'concrete anchors': ['wedge-anchor-1-2'],
    'joist hangers': ['joist-hanger'],
    'hurricane ties': ['hurricane-tie'],
    'post bases': ['post-base'],
  },
  Roofing: {
    'asphalt shingles': ['shingle-asphalt-architectural'],
    'corrugated metal': ['metal-corrugated'],
    'standing-seam metal': ['metal-standing-seam'],
    underlayment: ['underlayment-synthetic'],
    'drip edge': ['drip-edge-aluminum'],
    'gutters and downspouts': ['gutter-k5-aluminum', 'downspout-2x3-aluminum'],
  },
  Envelope: {
    'house wrap': ['house-wrap'],
    flashing: ['flashing-aluminum', 'flashing-tape'],
    'siding (lap)': ['siding-lap-engineered'],
    'siding (board-and-batten)': ['siding-board-batten'],
    'siding (fiber cement)': ['siding-lap-fiber-cement'],
    trim: ['trim-pvc', 'trim-primed-pine'],
    'soffit and fascia': ['soffit-vinyl-vented', 'fascia-primed-pine'],
  },
  Insulation: {
    'fiberglass batts': ['batt-fiberglass-r13', 'batt-fiberglass-r19', 'batt-fiberglass-r30'],
    'mineral wool': ['mineral-wool-r15', 'mineral-wool-r23'],
    'rigid foam': ['rigid-xps', 'rigid-polyiso', 'rigid-eps'],
  },
  Openings: {
    'windows (single-hung)': ['window-single-hung'],
    'windows (double-hung)': ['window-double-hung'],
    'windows (casement)': ['window-casement'],
    'windows (sliding)': ['window-sliding'],
    'windows (awning)': ['window-awning'],
    'windows (fixed/picture)': ['window-fixed'],
    'doors (entry)': ['door-entry'],
    'doors (French)': ['door-french'],
    'doors (sliding glass)': ['door-sliding-glass'],
    'safety glass': ['glass-tempered'],
  },
};

/** The Appendix A group each catalog category belongs to. */
const GROUP_CATEGORIES: Record<string, string[]> = {
  Lumber: ['lumber'],
  'Engineered wood': ['engineered-wood'],
  'Sheet goods': ['sheet'],
  'Concrete and masonry': ['concrete', 'masonry', 'steel', 'other'],
  'Fasteners and hardware': ['fastener'],
  Roofing: ['roofing'],
  Envelope: ['envelope'],
  Insulation: ['insulation'],
  Openings: ['opening'],
};

const materials = new Map(CATALOG.materials.map((m) => [m.id, m]));
const rows = Object.entries(TIER1).flatMap(([group, items]) =>
  Object.entries(items).map(([item, ids]) => [group, item, ids] as const),
);

describe('ADR-0001 Appendix A, tier 1', () => {
  it.each(rows)('%s: %s', (group, _item, ids) => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const m = materials.get(id);
      expect(m, id).toBeDefined();
      expect(GROUP_CATEGORIES[group], `${id} is ${m?.category}`).toContain(m!.category);
    }
  });

  it('every tier-1 material (bar the generic unit and site context) fulfils an Appendix A item', () => {
    const listed = new Set(rows.flatMap(([, , ids]) => ids));
    const extra = CATALOG.materials
      .filter((m) => !listed.has(m.id) && m.id !== 'opening-unit' && m.category !== 'site')
      .map((m) => m.id);
    expect(extra).toEqual([]);
  });
});
