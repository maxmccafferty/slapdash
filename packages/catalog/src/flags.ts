/**
 * Code-awareness flags (ADR-0001 §12) a catalog material may carry. The vocabulary is
 * deliberate: tests reject any flag not listed here, so a new one is added on purpose,
 * with its meaning.
 *
 * FLAG_RULES: the flags are only the vocabulary. The rules that read them (safety glazing
 * near a pool, GFCI, pool barriers, licensed trades, wet areas, thermal barriers, heavy
 * roofing) need geometry, so they live in `@slapdash/core` (`packages/core/src/code/notes.ts`).
 * They are reminders, not a code check.
 */
export const KNOWN_FLAGS = {
  'ground-contact': 'Rated for contact with soil or concrete (treated lumber, concrete).',
  'safety-glazing': 'Tempered or laminated glass, accepted in hazardous locations such as near a pool or in a door.',
  'not-safety-glazing': 'Ordinary annealed glazing: not allowed in hazardous locations without tempered glass.',
  'pool-barrier': 'Can form a pool barrier when built at least 4 ft tall with gaps under 4 in (IRC Appendix AG105 / ISPSC 305).',
  'not-pool-barrier': "Not used for pool barriers: e.g. 2 in chain-link mesh, which a child can climb (IRC AG105.2(6) allows 2 1/4 in, but many places require mini-mesh).",
  'pool-gate-hardware': 'Self-closing or self-latching gate hardware made for pool barrier gates.',
  gfci: 'A ground-fault (GFCI) device: protects itself and outlets downstream of it.',
  'receptacle-needs-gfci': 'An ordinary receptacle: needs GFCI protection outdoors, in wet areas and near a pool (NEC 210.8, 680.22).',
  'wet-area-rated': 'Made for showers, tubs and other wet areas (cement board, waterproofing membranes).',
  'not-for-wet-areas': "Not for showers or tub surrounds: paper-faced gypsum loses strength when wet.",
  'licensed-trade': 'Usually installed by a licensed electrician, plumber or HVAC tech, with a permit.',
  'thermal-barrier': 'Foam plastic insulation that needs a thermal barrier such as 1/2 in drywall when left inside a building (IRC R316.4).',
  'heavy-roofing': 'Heavy roofing (clay or concrete tile, about 9–12 psf): the rafters must be sized for it.',
} as const;

export type KnownFlag = keyof typeof KNOWN_FLAGS;

export function isKnownFlag(flag: string): flag is KnownFlag {
  return Object.hasOwn(KNOWN_FLAGS, flag);
}
