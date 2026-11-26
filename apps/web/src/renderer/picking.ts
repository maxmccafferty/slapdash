/**
 * Pointing (ADR-0003 §A, HANDOFF "Not designed"): on a phone the one touch interaction is
 * pointing, so the rule is tap = select, drag = orbit. A tap is one pointer that moved at
 * most 6 px and was held at most 500 ms. Mouse clicks follow the same rule.
 */
import type { Project } from '@slapdash/core';

export const TAP_MAX_MOVE_PX = 6;
export const TAP_MAX_MS = 500;

export interface Gesture {
  downAt: number;
  upAt: number;
  /** Largest distance from the down point, in CSS px. */
  moved_px: number;
  /** Most pointers down at once during the gesture. */
  maxPointers: number;
}

export function isTap(g: Gesture): boolean {
  return g.maxPointers === 1 && g.moved_px <= TAP_MAX_MOVE_PX && g.upAt - g.downAt <= TAP_MAX_MS;
}

const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** How a part is named to the user and Claude: "Header, South wall". The part name wins when set. */
export function partLabel(project: Project, partId: string): string | null {
  const part = project.parts[partId];
  if (!part) return null;
  const name = part.name?.trim() || capitalise(part.role);
  const assembly = project.assemblies[part.assemblyId];
  return assembly ? `${name}, ${assembly.name}` : name;
}
