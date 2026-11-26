/**
 * The materials report for the project in the model store: one `takeoff` per immutable
 * project (a WeakMap, like `buildSheet`), so the two tabs and the PDF share one result and
 * it recomputes only when the bus changes the project.
 */
import { PRICE_TABLE } from '@slapdash/catalog';
import { takeoff, type CatalogIndex, type MaterialsReport, type Project } from '@slapdash/core';
import { useModelStore } from '../state/model-store.ts';

const cache = new WeakMap<Project, MaterialsReport>();

export function materialsReport(project: Project, catalog: CatalogIndex): MaterialsReport {
  let report = cache.get(project);
  if (!report) {
    report = takeoff(project, catalog, PRICE_TABLE);
    cache.set(project, report);
  }
  return report;
}

export function useMaterials(): MaterialsReport | null {
  return useModelStore((s) => (s.project && s.catalog ? materialsReport(s.project, s.catalog) : null));
}
