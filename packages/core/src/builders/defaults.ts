/**
 * Catalog IDs and sizes the builders use unless told otherwise. The tier-1 catalog
 * (packages/catalog) must include every ID here; `test/builders/catalog-defaults.test.ts`
 * checks the sample catalog does.
 */
import { z } from 'zod';
import { MM_PER_FOOT, MM_PER_INCH } from '../units/length.ts';

const IN = MM_PER_INCH;

export const BUILDER_DEFAULTS = {
  materials: {
    lumber: 'spf-no2',
    treatedLumber: 'pt-spf-no2',
    sheathing: 'osb-7-16',
    subfloor: 'plywood-cdx',
    concrete: 'concrete-3000',
    siteContext: 'site-context',
    /** Tiers 2 and 3: fence styles, pergola roofing and decking. */
    polycarbonate: 'polycarbonate-corrugated',
    metalRoofing: 'metal-corrugated',
    chainLinkFabric: 'chain-link-fabric-2in',
    chainLinkMiniMesh: 'chain-link-fabric-mini-mesh',
    chainLinkPipe: 'chain-link-pipe',
    aluminumPanel: 'fence-panel-aluminum',
    aluminumPost: 'fence-post-aluminum',
    glassFencePanel: 'glass-pool-fence-panel',
    woodDecking: 'pt-syp-no2-gc',
    compositeDecking: 'composite-decking',
    cableRail: 'cable-rail-infill',
    glassRailing: 'glass-railing-panel',
  },
  sections: {
    stud: '2x4',
    joist: '2x8',
    rafter: '2x6',
    fencePost: '4x4',
    fenceRail: '2x4',
    privacyBoard: '1x6',
    picketBoard: '1x4',
    letInBrace: '1x4',
    gateFrame: '2x4',
    deckBoard: '5-4x6',
    deckPost: '6x6',
    deckBeam: '2x10',
    stringer: '2x12',
    baluster: '2x2',
    railCap: '2x6',
    railPost: '4x4',
    pergolaPost: '6x6',
    pergolaBeam: '2x8',
    pergolaRafter: '2x6',
    purlin: '2x4',
    chainLinkLine: 'chainlink-line-1-5-8',
    chainLinkTerminal: 'chainlink-terminal-2-3-8',
    chainLinkRail: 'chainlink-rail-1-3-8',
    aluminumPost: 'alu-post-2x2',
  },
  jointTypes: {
    nail16d: 'nailed-16d',
    nail8d: 'nailed-8d',
    hurricaneTie: 'hurricane-tie',
    anchorBolt: 'anchor-bolt',
    castInPlace: 'cast-in-place',
    postEmbedded: 'post-embedded',
    postBase: 'post-base',
    boltedThrough: 'bolted-through',
    screwedStructural: 'screwed-structural',
    screwedDeck: 'screwed-deck',
    screwedRoofing: 'screwed-roofing',
    gateHinge: 'gate-hinge',
    gateHingeSelfClosing: 'gate-hinge-self-closing',
    gateLatch: 'gate-latch',
    gateLatchMagnetic: 'gate-latch-magnetic',
    glassSpigot: 'glass-spigot',
  },
  /** 4×8 sheet. */
  sheet: { long: 96 * IN, short: 48 * IN },
  /** 7/16in OSB wall and roof sheathing. */
  sheathingThickness: (7 / 16) * IN,
  /** 23/32in ("3/4in") plywood subfloor. */
  subfloorThickness: (23 / 32) * IN,
  /** Plate and stud thickness of nominal 2x lumber. */
  twoBy: 1.5 * IN,
  /** Ground snow load used when the project has no override (psf). */
  groundSnowPsf: 30,
  /** Footing depth below grade when the project has no frost-depth override. */
  footingDepth: 12 * IN,
  /** Building width used for header sizing when nothing tells us better (ft). */
  buildingWidthFt: 36,
  /** Window rough-opening top above the subfloor, aligned with a standard door head. */
  headHeight: 82.5 * IN,
  maxSlabSide: 100 * MM_PER_FOOT,
} as const;

export const zBuilderMaterials = z
  .strictObject({
    lumber: z.string().min(1).optional().describe('Framing lumber material ID. Default "spf-no2".'),
    treatedLumber: z
      .string()
      .min(1)
      .optional()
      .describe('Pressure-treated lumber for parts on concrete or in the ground. Default "pt-spf-no2".'),
    sheathing: z.string().min(1).optional().describe('Wall/roof sheathing sheet material ID. Default "osb-7-16".'),
    subfloor: z.string().min(1).optional().describe('Subfloor sheet material ID. Default "plywood-cdx".'),
    concrete: z.string().min(1).optional().describe('Concrete material ID. Default "concrete-3000".'),
  })
  .describe('Optional catalog material overrides. Leave out to use the defaults.');

export type BuilderMaterialsInput = z.output<typeof zBuilderMaterials>;

export interface ResolvedMaterials {
  lumber: string;
  treatedLumber: string;
  sheathing: string;
  subfloor: string;
  concrete: string;
}

export function resolveMaterials(input: BuilderMaterialsInput | undefined): ResolvedMaterials {
  const d = BUILDER_DEFAULTS.materials;
  return {
    lumber: input?.lumber ?? d.lumber,
    treatedLumber: input?.treatedLumber ?? d.treatedLumber,
    sheathing: input?.sheathing ?? d.sheathing,
    subfloor: input?.subfloor ?? d.subfloor,
    concrete: input?.concrete ?? d.concrete,
  };
}
