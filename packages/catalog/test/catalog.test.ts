import { describe, expect, it } from 'vitest';
import { BUILDER_DEFAULTS, validateCatalog, type Material } from '@slapdash/core';
import { KNOWN_FLAGS, TEXTURE_SETS, CATALOG, isKnownFlag } from '../src/index.ts';

const C = CATALOG;
const material = (id: string): Material => {
  const m = C.materials.find((x) => x.id === id);
  if (!m) throw new Error(`no material ${id}`);
  return m;
};
const PSI = 0.00689476;
const LBF = 4.448222;
/** RSI per mm for a labelled R-value (ft²·°F·h/BTU) over a thickness in inches. */
const rsiPerMm = (r: number, inches: number) => (r * 0.17611) / (inches * 25.4);

/** Joint types with no published capacity: their `source` starts "Estimate:". */
const ESTIMATED_JOINTS = [
  'post-embedded',
  'cast-in-place',
  'rebar-embedded',
  'mortared',
  'notched',
  'mortise-tenon',
  // Roofing fasteners: withdrawal is published (NDS 12.2C, manufacturer pull-out) but lateral values aren't.
  'nailed-roofing',
  'screwed-roofing',
  // Tiers 2 and 3: pipe fittings and gate hardware carry no structural rating; they are
  // listed so the materials list counts fittings and hardware.
  'glued-pvc',
  'glued-cpvc',
  'glued-abs',
  'crimped-pex',
  'sweated-copper',
  'threaded-galvanized',
  'clamped-no-hub',
  'welded-steel',
  'gate-hinge',
  'gate-hinge-self-closing',
  'gate-latch',
  'gate-latch-magnetic',
  'glass-spigot',
  'shade-sail-mount',
];

/** Materials drawn with their swatch only: no CC0 texture is honest enough. */
const SWATCH_ONLY_CATEGORIES = ['fastener', 'insulation', 'opening', 'site', 'plumbing', 'electrical', 'mechanical', 'sealant', 'fencing'];
const SWATCH_ONLY_IDS = [
  'underlayment-synthetic',
  'flashing-tape',
  'sonotube-form',
  // Clear, thin or wire-like products a texture can't show honestly.
  'polycarbonate-corrugated',
  'membrane-epdm',
  'membrane-tpo',
  'ridge-vent',
  'vapor-barrier-6mil',
  'cable-rail-infill',
  'glass-railing-panel',
  'shade-sail-hdpe',
  'landscape-fabric',
  'drain-pipe-perforated-4in',
];

/**
 * Tier-1 materials that predate the mass rule: hardware (counted from joints, rarely a
 * part), window and door units, and the sonotube form. Every other material that can be
 * a part has a density or an areal mass, so the solver doesn't warn about it.
 */
const NO_MASS_TIER1 = new Set([
  'nail-8d-common',
  'nail-10d-common',
  'nail-16d-common',
  'nail-roofing',
  'screw-structural',
  'screw-deck',
  'screw-metal-roofing',
  'bolt-1-2',
  'lag-3-8',
  'anchor-bolt-1-2',
  'wedge-anchor-1-2',
  'joist-hanger',
  'hurricane-tie',
  'post-base',
  'opening-unit',
  'window-single-hung',
  'window-double-hung',
  'window-casement',
  'window-sliding',
  'window-awning',
  'window-fixed',
  'door-entry',
  'door-french',
  'door-sliding-glass',
  'glass-tempered',
  'sonotube-form',
]);

describe('catalog (tiers 1–3)', () => {
  it('validates against the core schema', () => {
    const r = validateCatalog(C);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('every material has a swatch and a description', () => {
    for (const m of C.materials) {
      expect(m.swatch, m.id).toBeDefined();
      expect(m.description?.length, m.id).toBeGreaterThan(10);
    }
  });

  it('every material with numbers cites a source', () => {
    for (const m of C.materials) {
      const hasNumbers =
        m.structural !== undefined ||
        m.strength !== undefined ||
        m.density_kg_m3 !== undefined ||
        m.rValuePerMm !== undefined ||
        m.arealMass_kg_m2 !== undefined;
      if (hasNumbers) expect(m.source, m.id).toBeTruthy();
    }
  });

  it('every material that can be a built part carries a density or an areal mass', () => {
    const missing = C.materials
      .filter((m) => m.category !== 'site' && !NO_MASS_TIER1.has(m.id))
      .filter((m) => m.density_kg_m3 === undefined && m.arealMass_kg_m2 === undefined)
      .map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it('steel carries yield strength and modulus, and no beam values (the solver does not check steel yet)', () => {
    const steel = C.materials.filter((m) => m.category === 'steel');
    expect(steel.length).toBeGreaterThanOrEqual(5);
    for (const m of steel) {
      expect(m.strength?.yield_MPa, m.id).toBeGreaterThan(0);
      expect(m.structural, m.id).toBeUndefined();
      expect(m.density_kg_m3, m.id).toBeCloseTo(7850, -2);
    }
  });

  it('lumber and engineered wood carry structural values and density', () => {
    const wood = C.materials.filter((m) => m.category === 'lumber' || m.category === 'engineered-wood');
    expect(wood.length).toBeGreaterThanOrEqual(10);
    for (const m of wood) {
      expect(m.structural?.Fc_MPa, m.id).toBeGreaterThan(0);
      expect(m.structural?.Fc_perp_MPa, m.id).toBeGreaterThan(0);
      expect(m.density_kg_m3, m.id).toBeGreaterThan(300);
    }
  });

  it('concrete, masonry and rebar carry strength', () => {
    for (const id of ['concrete-3000', 'concrete-4000', 'cmu-standard']) {
      expect(material(id).strength?.compressive_MPa, id).toBeGreaterThan(0);
    }
    expect(material('rebar-gr60').strength?.yield_MPa).toBeCloseTo(60_000 * PSI, 0);
    // ACI 318-19 19.2.2.1(b): Ec = 57,000 √f'c psi.
    expect(material('concrete-3000').strength?.E_MPa).toBeCloseTo(57_000 * Math.sqrt(3000) * PSI, -1);
  });

  it('insulation carries R per mm', () => {
    for (const m of C.materials.filter((x) => x.category === 'insulation')) expect(m.rValuePerMm, m.id).toBeGreaterThan(0);
    // R-13 at 3 1/2in ≈ RSI 2.29.
    expect(material('batt-fiberglass-r13').rValuePerMm! * 88.9).toBeCloseTo(2.29, 2);
    // XPS ≈ R-5 per inch.
    expect(material('rigid-xps').rValuePerMm).toBeCloseTo(rsiPerMm(5, 1), 4);
  });

  it('roofing and envelope membranes carry their weight', () => {
    for (const m of C.materials.filter((x) => x.category === 'roofing' || x.category === 'envelope')) {
      expect(m.arealMass_kg_m2 ?? m.density_kg_m3, m.id).toBeGreaterThan(0);
    }
  });

  it('spot-checks transcribed values', () => {
    // NDS 2018 Supplement Table 4A, Spruce-Pine-Fir No.2: E = 1,400,000 psi, Fb = 875 psi.
    expect(material('spf-no2').structural!.E_MPa).toBeCloseTo(1_400_000 * PSI, 0);
    expect(material('spf-no2').structural!.Fb_MPa).toBeCloseTo(875 * PSI, 2);
    // Table 4A, Douglas Fir-Larch No.2: Fb = 900 psi, Fc⊥ = 625 psi.
    expect(material('df-l-no2').structural!.Fb_MPa).toBeCloseTo(900 * PSI, 2);
    expect(material('df-l-no2').structural!.Fc_perp_MPa).toBeCloseTo(625 * PSI, 2);
  });

  it('every joint type cites a source, and only the documented ones are estimates', () => {
    for (const j of C.jointTypes) expect(j.source, j.id).toBeTruthy();
    const estimates = C.jointTypes.filter((j) => j.source!.startsWith('Estimate:')).map((j) => j.id);
    expect(estimates.sort()).toEqual([...ESTIMATED_JOINTS].sort());
  });

  it('joint hardware is a fastener, and every fastener is some joint\'s hardware', () => {
    const byId = new Map(C.materials.map((m) => [m.id, m]));
    const used = new Set<string>();
    for (const j of C.jointTypes) {
      if (j.hardwareId === undefined) continue;
      expect(byId.get(j.hardwareId)?.category, j.id).toBe('fastener');
      used.add(j.hardwareId);
    }
    const fasteners = C.materials.filter((m) => m.category === 'fastener').map((m) => m.id);
    expect(fasteners.filter((id) => !used.has(id))).toEqual([]);
  });

  it('joint capacities are positive (16d nail: NDS Table 12N)', () => {
    for (const j of C.jointTypes) expect(j.capacity.shear_N, j.id).toBeGreaterThan(0);
    // NDS 2018 Table 12N, 16d common (0.162in), 1 1/2in side member, G = 0.42: Z = 120 lbf.
    expect(C.jointTypes.find((j) => j.id === 'nailed-16d')!.capacity.shear_N).toBeCloseTo(120 * LBF, -1);
  });

  it('uplift capacities are the published 160% values (the solver scales them by CD / 1.6)', () => {
    const withUplift = C.jointTypes.filter((j) => j.capacity.uplift_N !== undefined);
    expect(withUplift.length).toBeGreaterThan(0);
    for (const j of withUplift) expect(j.source, j.id).toMatch(/160%/);
  });

  it('the default wall, roof and floor sheets brace: they carry shear-panel values (SDPWS Table 4.3A)', () => {
    const { sheathing, subfloor } = BUILDER_DEFAULTS.materials;
    for (const id of [sheathing, subfloor]) {
      const sp = material(id).shearPanel;
      expect(sp, id).toBeDefined();
      expect(sp!.source, id).toMatch(/SDPWS/);
    }
    // 7/16in OSB, 8d at 6in edges: Ga = 16 kips/in; vw = 715 plf, ÷ 2.0 for ASD.
    const osb = material('osb-7-16').shearPanel!;
    expect(osb.Ga_N_per_mm).toBeCloseTo(16 * 175.127, 0);
    expect(osb.vAllowable_N_per_mm).toBeCloseTo((715 / 2) * 0.0145939, 2);
  });

  it('every joint type is accepted by some material', () => {
    const accepted = new Set(C.materials.flatMap((m) => m.acceptsJoints));
    expect(C.jointTypes.map((j) => j.id).filter((id) => !accepted.has(id))).toEqual([]);
  });

  it('flags come from the known vocabulary', () => {
    for (const m of C.materials) for (const f of m.flags ?? []) expect(isKnownFlag(f), `${m.id}: ${f}`).toBe(true);
    expect(Object.keys(KNOWN_FLAGS)).toContain('ground-contact');
    expect(material('glass-tempered').flags).toContain('safety-glazing');
    expect(material('window-single-hung').flags).toContain('not-safety-glazing');
    expect(material('pt-syp-no2-gc').flags).toContain('ground-contact');
    expect(material('glass-pool-fence-panel').flags).toEqual(expect.arrayContaining(['safety-glazing', 'pool-barrier']));
    expect(material('chain-link-fabric-2in').flags).toContain('not-pool-barrier');
    expect(material('chain-link-fabric-mini-mesh').flags).toContain('pool-barrier');
    expect(material('gate-hinge-self-closing').flags).toContain('pool-gate-hardware');
    expect(material('gate-latch-magnetic').flags).toContain('pool-gate-hardware');
    expect(material('receptacle-gfci-20a').flags).toContain('gfci');
    expect(material('receptacle-15a').flags).toContain('receptacle-needs-gfci');
    expect(material('subpanel-100a').flags).toContain('licensed-trade');
    expect(material('drywall-gypsum').flags).toContain('not-for-wet-areas');
    expect(material('cement-board').flags).toContain('wet-area-rated');
    expect(material('rigid-xps').flags).toContain('thermal-barrier');
    expect(material('tile-roof-clay').flags).toContain('heavy-roofing');
    expect(material('skylight').flags).toContain('safety-glazing');
  });

  it('every known flag is used by some material', () => {
    const used = new Set(C.materials.flatMap((m) => m.flags ?? []));
    expect(Object.keys(KNOWN_FLAGS).filter((f) => !used.has(f))).toEqual([]);
  });

  it('texture sets exist, and only the swatch-only materials go without one', () => {
    const sets = new Set(TEXTURE_SETS.map((s) => s.id));
    for (const m of C.materials) {
      if (m.textureSet !== undefined) expect(sets.has(m.textureSet), `${m.id}: ${m.textureSet}`).toBe(true);
      else expect(SWATCH_ONLY_CATEGORIES.includes(m.category) || SWATCH_ONLY_IDS.includes(m.id), m.id).toBe(true);
    }
    const used = new Set(C.materials.flatMap((m) => (m.textureSet ? [m.textureSet] : [])));
    expect([...sets].filter((s) => !used.has(s))).toEqual([]);
  });

  it('every section is made in some material, and every material category a section lists exists', () => {
    const categories = new Set(C.materials.map((m) => m.category));
    for (const s of C.sections) {
      for (const c of s.materialCategories) expect(categories.has(c), `${s.id}: ${c}`).toBe(true);
    }
  });

  it('the generic opening unit is the first opening material that takes 16d nails', () => {
    const first = C.materials.find((m) => m.category === 'opening' && m.acceptsJoints.includes('nailed-16d'));
    expect(first?.id).toBe('opening-unit');
  });
});
