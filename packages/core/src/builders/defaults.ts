/**
 * Catalog IDs and sizes the builders use unless told otherwise. The tier-1 catalog
 * (packages/catalog) must include every ID here; `test/builders/catalog-defaults.test.ts`
 * checks the sample catalog does.
 */
import { z } from 'zod';
import { zId } from '../commands/common.ts';
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
  },
  jointTypes: {
    nail16d: 'nailed-16d',
    nail8d: 'nailed-8d',
    hurricaneTie: 'hurricane-tie',
    anchorBolt: 'anchor-bolt',
    castInPlace: 'cast-in-place',
    postEmbedded: 'post-embedded',
    postBase: 'post-base',
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
    lumber: zId.optional().describe('Framing lumber material ID. Default spf-no2.'),
    treatedLumber: zId
      .optional()
      .describe('Pressure-treated lumber for parts on concrete or in the ground. Default pt-spf-no2.'),
    sheathing: zId.optional().describe('Wall/roof sheathing sheet material ID. Default osb-7-16.'),
    subfloor: zId.optional().describe('Subfloor sheet material ID. Default plywood-cdx.'),
    concrete: zId.optional().describe('Concrete material ID. Default concrete-3000.'),
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
