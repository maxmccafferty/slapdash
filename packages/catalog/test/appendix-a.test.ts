/**
 * ADR-0001 Appendix A, all three tiers, made executable: each item, in the ADR's words,
 * maps to the catalog ids that satisfy it. Items a builder makes rather than a product
 * map to `builder:<command>` (or `builder:build_fence:<style>`), `place_structure:<kind>`
 * for site context, and the few items that are later work are listed in DEFERRED.
 */
import { describe, expect, it } from 'vitest';
import { FENCE_STYLES, STRUCTURE_KINDS, exposedCommands } from '@slapdash/core';
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

const TIER2: Record<string, Record<string, string[]>> = {
  Interior: {
    drywall: ['drywall-gypsum'],
    'cement board for wet areas': ['cement-board'],
    'paint and stain': ['paint-interior-latex', 'paint-exterior-acrylic', 'stain-exterior'],
  },
  Tile: {
    ceramic: ['tile-ceramic'],
    porcelain: ['tile-porcelain'],
    'natural stone': ['tile-natural-stone'],
    // Not named in the ADR, but tile needs them to be set.
    'setting materials (thinset and grout)': ['thinset-mortar', 'grout-sanded'],
  },
  Flooring: {
    hardwood: ['flooring-hardwood-oak'],
    'luxury vinyl plank': ['flooring-lvp'],
    'sealed or polished concrete': ['concrete-sealer', 'concrete-polished'],
    epoxy: ['epoxy-floor-coating'],
  },
  Plumbing: {
    PVC: ['pipe-pvc-dwv', 'pipe-pvc-sch40'],
    CPVC: ['pipe-cpvc'],
    PEX: ['pipe-pex'],
    copper: ['pipe-copper-type-l'],
    ABS: ['pipe-abs-dwv'],
    'cast iron': ['pipe-cast-iron-no-hub'],
    galvanized: ['pipe-galvanized'],
    fittings: ['fitting-pvc', 'fitting-cpvc', 'fitting-abs', 'fitting-pex-crimp', 'fitting-copper-sweat', 'fitting-galvanized', 'coupling-no-hub'],
    valves: ['valve-ball', 'hose-bib'],
    traps: ['p-trap'],
    vents: ['air-admittance-valve', 'vent-pipe-flashing'],
    'fixtures (toilet)': ['toilet'],
    'fixtures (sink)': ['vanity-sink'],
    'fixtures (outdoor shower)': ['outdoor-shower'],
    'water heater': ['water-heater-tank'],
  },
  Electrical: {
    'PVC and EMT conduit': ['conduit-pvc-sch40', 'conduit-emt'],
    'wire by gauge': ['wire-thhn-12', 'wire-thhn-10', 'cable-nm-b-14-2', 'cable-nm-b-12-2', 'cable-uf-b-12-2'],
    boxes: ['box-old-work-1g', 'box-weatherproof'],
    // The plain receptacle is there so the GFCI rule has something to flag.
    'GFCI outlets': ['receptacle-gfci-20a', 'receptacle-15a'],
    lights: ['light-exterior-wet', 'light-recessed-led'],
    subpanel: ['subpanel-100a'],
  },
  'Stone and brick': {
    brick: ['brick-clay-modular'],
    'stone veneer': ['stone-veneer-manufactured'],
    flagstone: ['flagstone'],
    pavers: ['paver-concrete'],
    'retaining wall block': ['retaining-wall-block'],
  },
  'More openings': {
    'bay windows': ['window-bay'],
    'bifold doors': ['door-bifold'],
    'barn doors': ['door-barn'],
    'roll-up/garage doors': ['door-garage-rollup'],
    skylights: ['skylight'],
  },
  'More roofing': {
    'clear polycarbonate panels (pergolas)': ['polycarbonate-corrugated'],
    'clay/concrete tile': ['tile-roof-clay', 'tile-roof-concrete'],
    'EPDM/TPO membrane': ['membrane-epdm', 'membrane-tpo'],
  },
};

const TIER3: Record<string, Record<string, string[]>> = {
  'Fences and gates': {
    'wood picket': ['builder:build_fence:picket', 'pt-spf-no2', 'cedar-wrc'],
    'wood privacy': ['builder:build_fence:privacy', 'pt-spf-no2', 'cedar-wrc'],
    'chain link': ['builder:build_fence:chain-link', 'chain-link-fabric-2in', 'chain-link-fabric-mini-mesh', 'chain-link-pipe'],
    // Aluminum stands in for wrought iron: it is what's sold for pool-code ornamental fences.
    'wrought iron/aluminum': ['builder:build_fence:aluminum', 'fence-panel-aluminum', 'fence-post-aluminum'],
    'glass pool fence': ['builder:build_fence:glass', 'glass-pool-fence-panel', 'glass-spigot'],
    'gate hardware': ['gate-hinge-pair', 'gate-hinge-self-closing', 'gate-latch-gravity', 'gate-latch-magnetic'],
  },
  'Decking and railings': {
    'wood decking': ['builder:build_deck', 'pt-syp-no2-gc', 'cedar-wrc'],
    'composite decking': ['builder:build_deck', 'composite-decking'],
    'cable railings': ['cable-rail-infill'],
    'glass railings': ['glass-railing-panel'],
    stairs: ['builder:build_deck'],
  },
  'Outdoor structures': {
    pergolas: ['builder:build_pergola'],
    'shade sails': ['shade-sail-hdpe', 'shade-sail-mount-kit'],
    sheds: ['builder:build_wall', 'builder:build_roof'],
    'outdoor kitchen pieces': ['grill-insert', 'outdoor-sink', 'countertop-concrete'],
    'pool equipment pad': ['pool-equipment-pad'],
    'pool coping': ['coping-precast-concrete', 'coping-travertine'],
  },
  Steel: {
    'steel studs': ['steel-stud-20ga'],
    'square tube': ['steel-hss-a500'],
    angle: ['steel-angle-a36'],
    'I-beams': ['steel-w-a992'],
  },
  'Insulation and HVAC extras': {
    'spray foam': ['spray-foam-closed-cell', 'spray-foam-open-cell'],
    'vapor barrier': ['vapor-barrier-6mil'],
    'mini-split': ['mini-split-ductless'],
    'vents and fans': ['exhaust-fan-bath', 'gable-vent', 'ridge-vent'],
  },
  Sealants: {
    caulk: ['caulk-silicone', 'caulk-polyurethane'],
    'construction adhesive': ['adhesive-construction'],
    'waterproofing membrane': ['waterproofing-membrane-liquid'],
  },
  Site: {
    trees: ['place_structure:tree'],
    'existing house and pool': ['place_structure:house', 'place_structure:pool'],
    'drainage (French drains)': ['drain-pipe-perforated-4in', 'gravel-base'],
    'landscape fabric': ['landscape-fabric'],
  },
};

/** Appendix A items that are later work, with the planned work item that covers them. */
const DEFERRED: Record<string, string> = {
  'Site: terrain and grading': 'planned work item 11 (site context)',
  'Site: property lines': 'planned work item 11 (site context)',
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
  Interior: ['sheet', 'finish'],
  Tile: ['finish', 'sealant'],
  Flooring: ['finish'],
  Plumbing: ['plumbing', 'fastener'],
  Electrical: ['electrical'],
  'Stone and brick': ['masonry'],
  'More openings': ['opening'],
  'More roofing': ['roofing'],
  'Fences and gates': ['lumber', 'fencing', 'steel', 'fastener'],
  'Decking and railings': ['lumber', 'decking'],
  'Outdoor structures': ['other', 'fastener', 'mechanical', 'plumbing', 'finish', 'masonry'],
  Steel: ['steel'],
  'Insulation and HVAC extras': ['insulation', 'envelope', 'mechanical', 'roofing'],
  Sealants: ['sealant'],
  Site: ['other'],
};

const materials = new Map(CATALOG.materials.map((m) => [m.id, m]));
const rowsOf = (tier: Record<string, Record<string, string[]>>) =>
  Object.entries(tier).flatMap(([group, items]) => Object.entries(items).map(([item, ids]) => [group, item, ids] as const));
const rows = rowsOf(TIER1);
const allRows = [...rows, ...rowsOf(TIER2), ...rowsOf(TIER3)];
const builderNames = new Set(exposedCommands().map((c) => c.name));

function checkRow(group: string, ids: readonly string[]) {
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    if (id.startsWith('builder:')) {
      const [, name, style] = id.split(':');
      expect(builderNames.has(name!), id).toBe(true);
      if (style !== undefined) expect(FENCE_STYLES as readonly string[], id).toContain(style);
      continue;
    }
    if (id.startsWith('place_structure:')) {
      expect(STRUCTURE_KINDS as readonly string[], id).toContain(id.split(':')[1]);
      continue;
    }
    const m = materials.get(id);
    expect(m, id).toBeDefined();
    expect(GROUP_CATEGORIES[group], `${id} is ${m?.category}`).toContain(m!.category);
  }
}

describe('ADR-0001 Appendix A, tier 1', () => {
  it.each(rows)('%s: %s', (group, _item, ids) => checkRow(group, ids));
});

describe('ADR-0001 Appendix A, tier 2', () => {
  it.each(rowsOf(TIER2))('%s: %s', (group, _item, ids) => checkRow(group, ids));
});

describe('ADR-0001 Appendix A, tier 3', () => {
  it.each(rowsOf(TIER3))('%s: %s', (group, _item, ids) => checkRow(group, ids));
});

describe('ADR-0001 Appendix A, coverage', () => {
  it('every catalog material (bar the generic unit and site context) fulfils an Appendix A item', () => {
    const listed = new Set(allRows.flatMap(([, , ids]) => ids));
    const extra = CATALOG.materials.filter((m) => !listed.has(m.id) && m.id !== 'opening-unit' && m.category !== 'site').map((m) => m.id);
    expect(extra).toEqual([]);
  });

  it('only terrain and grading, and property lines, are deferred (to site context work)', () => {
    expect(Object.keys(DEFERRED).sort()).toEqual(['Site: property lines', 'Site: terrain and grading']);
    for (const why of Object.values(DEFERRED)) expect(why).toMatch(/planned work item 11/);
  });
});
