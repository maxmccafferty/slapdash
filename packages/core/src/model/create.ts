import { PROJECT_SCHEMA_VERSION, type Project } from './schema.ts';
import type { UnitSystem } from '../units/length.ts';

export const GROUND_LEVEL_ID = 'L0';

export interface CreateProjectOptions {
  name: string;
  display?: UnitSystem;
}

/** An empty project: one ground level (L0) at elevation 0 and nothing on it. */
export function createProject(opts: CreateProjectOptions): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: opts.name,
    units: { display: opts.display ?? 'imperial' },
    levels: [{ id: GROUND_LEVEL_ID, name: 'Ground', elevation_mm: 0 }],
    assemblies: {},
    parts: {},
    joints: {},
    site: { designLoads: {} },
    counters: { assemblies: {}, parts: {}, joints: 0 },
  };
}
