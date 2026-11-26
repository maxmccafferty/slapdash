/**
 * Code-awareness flags (ADR-0001 §12) a tier-1 material may carry. The vocabulary is
 * deliberate: tests reject any flag not listed here, so a new one is added on purpose,
 * with its meaning.
 */
export const KNOWN_FLAGS = {
  'ground-contact': 'Rated for contact with soil or concrete (treated lumber, concrete).',
  'safety-glazing': 'Tempered or laminated glass, accepted in hazardous locations such as near a pool or in a door.',
  'not-safety-glazing': 'Ordinary annealed glazing: not allowed in hazardous locations without tempered glass.',
} as const;

export type KnownFlag = keyof typeof KNOWN_FLAGS;

export function isKnownFlag(flag: string): flag is KnownFlag {
  return Object.hasOwn(KNOWN_FLAGS, flag);
}
