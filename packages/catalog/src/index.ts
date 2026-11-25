/**
 * @slapdash/catalog — the catalog, tiers 1–3 (ADR-0001 Appendix A), the dated price table
 * (§11) and the CC0 texture manifest (§6). Plain JSON under `data/` and `textures/`,
 * validated against the `@slapdash/core` schema once, at import: a broken catalog
 * throws here, so the app can never start on one.
 *
 * Material order is the file order below, and within a file the entry order. It matters
 * for openings: builders use the first `opening` material that accepts 16d nails as the
 * window/door unit, which is the generic `opening-unit`.
 */
import { validateCatalog, validatePriceTable, type Catalog, type PriceTable } from '@slapdash/core';
import sections from '../data/sections.json' with { type: 'json' };
import jointTypes from '../data/joint-types.json' with { type: 'json' };
import lumber from '../data/materials/lumber.json' with { type: 'json' };
import engineeredWood from '../data/materials/engineered-wood.json' with { type: 'json' };
import sheetGoods from '../data/materials/sheet-goods.json' with { type: 'json' };
import concreteMasonry from '../data/materials/concrete-masonry.json' with { type: 'json' };
import fastenersHardware from '../data/materials/fasteners-hardware.json' with { type: 'json' };
import roofing from '../data/materials/roofing.json' with { type: 'json' };
import envelope from '../data/materials/envelope.json' with { type: 'json' };
import insulation from '../data/materials/insulation.json' with { type: 'json' };
import openings from '../data/materials/openings.json' with { type: 'json' };
import site from '../data/materials/site.json' with { type: 'json' };
import interior from '../data/materials/interior.json' with { type: 'json' };
import tile from '../data/materials/tile.json' with { type: 'json' };
import flooring from '../data/materials/flooring.json' with { type: 'json' };
import plumbing from '../data/materials/plumbing.json' with { type: 'json' };
import electrical from '../data/materials/electrical.json' with { type: 'json' };
import stoneBrick from '../data/materials/stone-brick.json' with { type: 'json' };
import fencing from '../data/materials/fencing.json' with { type: 'json' };
import decking from '../data/materials/decking.json' with { type: 'json' };
import outdoor from '../data/materials/outdoor.json' with { type: 'json' };
import steel from '../data/materials/steel.json' with { type: 'json' };
import hvacSealants from '../data/materials/hvac-sealants.json' with { type: 'json' };
import prices from '../data/prices.json' with { type: 'json' };
import textureManifest from '../textures/manifest.json' with { type: 'json' };
import { zTextureManifest, type TextureSet } from './textures.ts';

export {
  DESIGN_LOAD_ROWS,
  DESIGN_LOAD_TABLE,
  toDesignLoadTable,
  validateDesignLoadRows,
  zDesignLoadRow,
  type DesignLoadRow,
} from './design-loads.ts';
export { KNOWN_FLAGS, isKnownFlag, type KnownFlag } from './flags.ts';
export { TEXTURE_MAPS, texturePath, zTextureManifest, zTextureSet, type TextureManifest, type TextureMap, type TextureSet } from './textures.ts';

/** The data version: the day the catalog and its prices were last researched. */
export const CATALOG_VERSION = '2026-11-25';

/**
 * The Appendix A groups, one JSON file each, in load order. Tier 1 first, then tiers 2 and
 * 3, so `opening-unit` stays the first opening.
 */
export const MATERIAL_GROUPS = {
  lumber,
  'engineered-wood': engineeredWood,
  'sheet-goods': sheetGoods,
  'concrete-masonry': concreteMasonry,
  'fasteners-hardware': fastenersHardware,
  roofing,
  envelope,
  insulation,
  openings,
  site,
  // Tier 2 (finishing a pool house).
  interior,
  tile,
  flooring,
  plumbing,
  electrical,
  'stone-brick': stoneBrick,
  // Tier 3 (the rest of the backyard).
  fencing,
  decking,
  outdoor,
  steel,
  'hvac-sealants': hvacSealants,
} as const;

function invalid(what: string, errors: readonly string[]): never {
  throw new Error(`The ${what} is invalid:\n- ${errors.join('\n- ')}`);
}

const catalogResult = validateCatalog({
  schemaVersion: 1,
  catalogVersion: CATALOG_VERSION,
  materials: Object.values(MATERIAL_GROUPS).flat(),
  sections,
  jointTypes,
});
if (!catalogResult.ok) invalid('catalog', catalogResult.errors);

/**
 * The whole catalog, tiers 1–3: the pool-house shell, finishing it (interiors, tile,
 * flooring, plumbing, electrical, stone and brick) and the rest of the backyard (fencing,
 * decking, outdoor living, steel, HVAC and sealants).
 */
export const CATALOG: Catalog = catalogResult.catalog;

const priceResult = validatePriceTable(prices, CATALOG);
if (!priceResult.ok) invalid('price table', priceResult.errors);

/** Low–high US retail prices, researched once on `researchedOn`. Planning estimates, not quotes. */
export const PRICE_TABLE: PriceTable = priceResult.table;

const textureResult = zTextureManifest.safeParse(textureManifest);
if (!textureResult.success) invalid('texture manifest', textureResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

/** CC0 texture sets, encoded as KTX2 under `textures/<id>/<map>.ktx2`. */
export const TEXTURE_SETS: readonly TextureSet[] = textureResult.data.sets;
