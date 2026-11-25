import { zCatalog, type Catalog, type JointType, type Material, type Section } from './schema.ts';
import { migrateCatalog } from './migrate.ts';
import { zodIssuesToErrors } from '../commands/errors.ts';

export type CatalogResult = { ok: true; catalog: Catalog } | { ok: false; errors: string[] };

/**
 * Validate a raw catalog: migrate it to the current version, check its shape, then
 * check what a schema can't: ids are unique within each list, every
 * `acceptsJoints` entry names a real joint type, every joint type's `hardwareId`
 * names a fastener and each section's stock lengths are sorted and unique. Errors are plain sentences.
 */
export function validateCatalog(raw: unknown): CatalogResult {
  const migrated = migrateCatalog(raw);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };

  const parsed = zCatalog.safeParse(migrated.value);
  if (!parsed.success) {
    return { ok: false, errors: zodIssuesToErrors(parsed.error.issues, migrated.value).map((e) => e.message) };
  }
  const catalog = parsed.data;
  const errors: string[] = [];

  const checkUnique = (list: ReadonlyArray<{ id: string }>, what: string) => {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) errors.push(`Two ${what} share the id "${item.id}"; ids must be unique.`);
      seen.add(item.id);
    }
  };
  checkUnique(catalog.materials, 'materials');
  checkUnique(catalog.sections, 'sections');
  checkUnique(catalog.jointTypes, 'joint types');

  for (const s of catalog.sections) {
    const lengths = (s.stock ?? []).map((st) => st.length_mm);
    for (let i = 1; i < lengths.length; i++) {
      if (lengths[i]! === lengths[i - 1]!) {
        errors.push(`Section "${s.id}" lists the stock length ${lengths[i]} mm twice.`);
      } else if (lengths[i]! < lengths[i - 1]!) {
        errors.push(`Section "${s.id}" lists its stock lengths out of order; put them shortest first.`);
      }
    }
  }

  const jointIds = new Set(catalog.jointTypes.map((j) => j.id));
  for (const m of catalog.materials) {
    for (const j of m.acceptsJoints) {
      if (!jointIds.has(j)) {
        errors.push(`Material "${m.id}" accepts joint type "${j}", which isn't in the catalog.`);
      }
    }
  }

  const materials = new Map(catalog.materials.map((m) => [m.id, m]));
  for (const j of catalog.jointTypes) {
    if (j.hardwareId === undefined) continue;
    const hw = materials.get(j.hardwareId);
    if (!hw) {
      errors.push(`Joint type "${j.id}" uses hardware "${j.hardwareId}", which isn't in the catalog.`);
    } else if (hw.category !== 'fastener') {
      errors.push(`Joint type "${j.id}" uses hardware "${j.hardwareId}", but "${j.hardwareId}" is ${hw.category}, not a fastener.`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, catalog };
}

/** A catalog with O(1) lookups by id. */
export interface CatalogIndex {
  readonly catalog: Catalog;
  readonly materials: ReadonlyMap<string, Material>;
  readonly sections: ReadonlyMap<string, Section>;
  readonly jointTypes: ReadonlyMap<string, JointType>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  return {
    catalog,
    materials: new Map(catalog.materials.map((m) => [m.id, m])),
    sections: new Map(catalog.sections.map((s) => [s.id, s])),
    jointTypes: new Map(catalog.jointTypes.map((j) => [j.id, j])),
  };
}

export function isCatalogIndex(value: Catalog | CatalogIndex): value is CatalogIndex {
  return (value as CatalogIndex).materials instanceof Map;
}
