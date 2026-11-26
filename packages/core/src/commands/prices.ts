/**
 * The person's own prices (ADR-0001 §11, ADR-0003 §F.3): prices are given by telling
 * Claude, and replace the table's range for this project only. Undo goes through the
 * internal `set_prices`, which restores the whole map.
 */
import { z } from 'zod';
import { zPriceUnit } from '../catalog/prices.ts';
import type { Material } from '../catalog/schema.ts';
import type { CatalogIndex } from '../catalog/validate.ts';
import { priceUnitsFor, sheetVariant, unitWord } from '../materials/price.ts';
import { userPriceKey, type Project, type UserPrice } from '../model/schema.ts';
import { formatFeetInches, parseLength } from '../units/length.ts';
import { zPositiveLength } from '../units/zod.ts';
import { zId } from './common.ts';
import { commandError, notFound, type CommandError } from './errors.ts';
import { defineCommand } from './types.ts';

const MEMBER_CATEGORIES = new Set<Material['category']>(['lumber', 'engineered-wood', 'steel']);
const THICKNESS_CATEGORIES = new Set<Material['category']>(['sheet', 'insulation']);

const zMaterialId = zId.describe('Catalog material ID, e.g. spf-no2 or osb-7-16.');
const zSize = zId
  .optional()
  .describe('Only this size: a section like 2x4, or a sheet thickness like 23/32in. Leave out to price every size.');

type SizeResult = { ok: true; variant: string } | { ok: false; error: CommandError };

/** Turn the size the person gave into the price-table variant, or say why it can't be read. */
function resolveSize(material: Material, size: string, catalog: CatalogIndex): SizeResult {
  if (THICKNESS_CATEGORIES.has(material.category)) {
    const withUnit = /[a-z"'″]\s*$/i.test(size) ? size : `${size}in`;
    const parsed = parseLength(withUnit);
    if (!parsed.ok || !(parsed.value > 0)) {
      return {
        ok: false,
        error: commandError('invalid_input', `Couldn't read "${size}" as a thickness; try 23/32in or 1/2in.`, { path: 'size' }),
      };
    }
    return { ok: true, variant: sheetVariant(parsed.value) };
  }
  const wanted = size.toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  const section = [...catalog.sections.values()].find(
    (s) => s.id === wanted || s.nominal?.toLowerCase().replace(/\s+/g, '') === wanted,
  );
  if (!section) return { ok: false, error: notFound('size', size, catalog.sections.keys(), 'size') };
  if (MEMBER_CATEGORIES.has(material.category) && !section.materialCategories.includes(material.category)) {
    return { ok: false, error: commandError('invalid_input', `${material.name} doesn't come in ${section.name}.`, { path: 'size' }) };
  }
  return { ok: true, variant: section.id };
}

function money(usd: number): string {
  return usd < 1 ? `$${usd.toFixed(3).replace(/0$/, '')}` : `$${usd.toFixed(2)}`;
}

function sizeLabel(variant: string | undefined): string {
  return variant === undefined ? '' : ` ${variant}`;
}

function withPrices(project: Project, prices: Record<string, UserPrice> | undefined): Project {
  const next: Project = { ...project };
  if (prices === undefined || Object.keys(prices).length === 0) delete next.prices;
  else next.prices = prices;
  return next;
}

const restorePrices = (project: Project) => ({ name: 'set_prices', input: { prices: project.prices ?? null } });

export const setPrice = defineCommand({
  name: 'set_price',
  description:
    "Record the person's own price for a material in this project. It replaces the price table's range in the materials list and the cost total. Give a size to price one size only.",
  exposed: true,
  schema: z.strictObject({
    material: zMaterialId,
    size: zSize,
    price: z.number().positive().describe('The price in US dollars, e.g. 0.52 or 6.98.'),
    per: zPriceUnit.describe(
      'What the price is for: each, linear-ft, sheet, cu-yd, sq-ft or lb. Lumber priced each (per board) needs a length.',
    ),
    length: zPositiveLength.optional().describe('The board length a per-board (each) lumber price is for, e.g. 8ft.'),
    note: z.string().optional().describe('Where the price came from, e.g. Miller Lumber quote.'),
  }),
  check(_project, input, ctx) {
    const material = ctx.catalog.materials.get(input.material);
    if (!material) return [notFound('material', input.material, ctx.catalog.materials.keys(), 'material')];
    const errors: CommandError[] = [];
    if (input.size !== undefined) {
      const size = resolveSize(material, input.size, ctx.catalog);
      if (!size.ok) errors.push(size.error);
    }
    const units = priceUnitsFor(material);
    if (units.length === 0) {
      errors.push(commandError('not_allowed', `${material.name} isn't built, so it has no price.`, { path: 'material' }));
    } else if (!units.includes(input.per)) {
      errors.push(
        commandError(
          'invalid_input',
          `${material.name} can't be priced per ${unitWord(input.per)}; price it per ${units.map(unitWord).join(' or ')}.`,
          { path: 'per' },
        ),
      );
    } else if (input.per === 'each' && MEMBER_CATEGORIES.has(material.category) && input.length === undefined) {
      errors.push(commandError('invalid_input', 'A price per board needs the board length, e.g. length: 8ft.', { path: 'length' }));
    } else if (input.length !== undefined && input.per !== 'each') {
      errors.push(commandError('invalid_input', 'A length only goes with a price per board (per: each).', { path: 'length' }));
    }
    return errors;
  },
  apply(project, input, ctx) {
    const material = ctx.catalog.materials.get(input.material)!;
    let variant: string | undefined;
    if (input.size !== undefined) {
      const size = resolveSize(material, input.size, ctx.catalog);
      if (!size.ok) throw new Error(size.error.message);
      variant = size.variant;
    }
    const price: UserPrice = { materialId: material.id, usd: input.price, per: input.per, source: 'user' };
    if (variant !== undefined) price.variant = variant;
    if (input.length !== undefined) price.length_mm = input.length;
    if (input.note !== undefined) price.note = input.note;
    const prices = { ...project.prices, [userPriceKey(material.id, variant)]: price };

    const redo: Record<string, unknown> = { material: material.id, price: input.price, per: input.per };
    if (variant !== undefined) redo.size = variant;
    if (input.length !== undefined) redo.length = input.length;
    if (input.note !== undefined) redo.note = input.note;
    const per = input.per === 'each' ? 'each' : `per ${unitWord(input.per)}`;
    const board = input.length !== undefined ? ` (${formatFeetInches(input.length)} board)` : '';
    return {
      project: withPrices(project, prices),
      inverse: [restorePrices(project)],
      redo: { name: 'set_price', input: redo },
      summary: `Set ${material.name}${sizeLabel(variant)} to ${money(input.price)} ${per}${board} for this project, in place of the price table.`,
      created: [],
    };
  },
});

export const clearPrice = defineCommand({
  name: 'clear_price',
  description: "Remove the person's own price for a material (and size), going back to the price table.",
  exposed: true,
  schema: z.strictObject({ material: zMaterialId, size: zSize }),
  check(project, input, ctx) {
    const material = ctx.catalog.materials.get(input.material);
    if (!material) return [notFound('material', input.material, ctx.catalog.materials.keys(), 'material')];
    let variant: string | undefined;
    if (input.size !== undefined) {
      const size = resolveSize(material, input.size, ctx.catalog);
      if (!size.ok) return [size.error];
      variant = size.variant;
    }
    if (!project.prices?.[userPriceKey(material.id, variant)]) {
      const others = Object.values(project.prices ?? {}).filter((p) => p.materialId === material.id);
      return [
        commandError('not_found', `This project has no price of its own for ${material.name}${sizeLabel(variant)}.`, {
          path: 'material',
          ...(others.length > 0 ? { hint: `It has one for ${others.map((p) => p.variant ?? 'every size').join(', ')}.` } : {}),
        }),
      ];
    }
    return [];
  },
  apply(project, input, ctx) {
    const material = ctx.catalog.materials.get(input.material)!;
    let variant: string | undefined;
    if (input.size !== undefined) {
      const size = resolveSize(material, input.size, ctx.catalog);
      if (!size.ok) throw new Error(size.error.message);
      variant = size.variant;
    }
    const prices = { ...project.prices };
    delete prices[userPriceKey(material.id, variant)];
    return {
      project: withPrices(project, prices),
      inverse: [restorePrices(project)],
      redo: { name: 'clear_price', input: variant === undefined ? { material: material.id } : { material: material.id, size: variant } },
      summary: `Cleared your price for ${material.name}${sizeLabel(variant)}; using the price table.`,
      created: [],
    };
  },
});

/** Internal: replace the whole price map (the inverse of set_price and clear_price). */
export const setPricesCommand = defineCommand({
  name: 'set_prices',
  description: "Internal: replace the project's own prices.",
  exposed: false,
  schema: z.custom<{ prices: Record<string, UserPrice> | null }>((v) => typeof v === 'object' && v !== null),
  check: () => [],
  apply(project, input) {
    return {
      project: withPrices(project, input.prices ?? undefined),
      inverse: [restorePrices(project)],
      redo: { name: 'set_prices', input },
      summary: "Updated the project's prices.",
      created: [],
    };
  },
});

export const priceCommands = [setPrice, clearPrice];
