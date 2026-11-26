import type { Project } from '../model/schema.ts';

export interface SavedVersion {
  name: string;
  note?: string;
  savedAt: number;
  /** Held by reference: projects are immutable, so saving is cheap. */
  project: Project;
}

export interface VersionListItem {
  name: string;
  note?: string;
  savedAt: number;
  partCount: number;
  jointCount: number;
}

/** Named saves (ADR-0002 §D7). Names are trimmed and unique. */
export class VersionStore {
  #versions: SavedVersion[] = [];

  constructor(initial: readonly SavedVersion[] = []) {
    this.#versions = [...initial];
  }

  has(name: string): boolean {
    return this.#versions.some((v) => v.name === name.trim());
  }

  get(name: string): SavedVersion | undefined {
    return this.#versions.find((v) => v.name === name.trim());
  }

  add(version: SavedVersion): void {
    this.#versions.push(version);
  }

  names(): string[] {
    return this.#versions.map((v) => v.name);
  }

  list(): VersionListItem[] {
    return this.#versions.map((v) => {
      const item: VersionListItem = {
        name: v.name,
        savedAt: v.savedAt,
        partCount: Object.keys(v.project.parts).length,
        jointCount: Object.keys(v.project.joints).length,
      };
      if (v.note !== undefined) item.note = v.note;
      return item;
    });
  }

  all(): readonly SavedVersion[] {
    return this.#versions;
  }
}
