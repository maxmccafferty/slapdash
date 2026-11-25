/**
 * ASD load combinations (ASCE 7-22 §2.4.1), each with its NDS load-duration factor CD
 * (NDS 2018 Table 2.3.2): permanent 0.9, occupancy live 1.0, snow 1.15, roof live 1.25,
 * wind 1.6. A combination's CD is that of its shortest-duration load. Combinations with
 * wind expand over the four wind directions.
 */
import { WIND_CASES, type BasicCase } from '../types.ts';

export interface LoadCombination {
  name: string;
  CD: number;
  factors: Partial<Record<BasicCase, number>>;
}

function expand(): LoadCombination[] {
  const out: LoadCombination[] = [
    { name: 'D', CD: 0.9, factors: { D: 1 } },
    { name: 'D+L', CD: 1.0, factors: { D: 1, L: 1 } },
    { name: 'D+Lr', CD: 1.25, factors: { D: 1, Lr: 1 } },
    { name: 'D+S', CD: 1.15, factors: { D: 1, S: 1 } },
    { name: 'D+0.75L+0.75Lr', CD: 1.25, factors: { D: 1, L: 0.75, Lr: 0.75 } },
    { name: 'D+0.75L+0.75S', CD: 1.15, factors: { D: 1, L: 0.75, S: 0.75 } },
  ];
  for (const w of WIND_CASES) out.push({ name: `D+0.6${w}`, CD: 1.6, factors: { D: 1, [w]: 0.6 } });
  for (const w of WIND_CASES) {
    out.push({ name: `D+0.75L+0.45${w}+0.75Lr`, CD: 1.6, factors: { D: 1, L: 0.75, [w]: 0.45, Lr: 0.75 } });
    out.push({ name: `D+0.75L+0.45${w}+0.75S`, CD: 1.6, factors: { D: 1, L: 0.75, [w]: 0.45, S: 0.75 } });
  }
  for (const w of WIND_CASES) out.push({ name: `0.6D+0.6${w}`, CD: 1.6, factors: { D: 0.6, [w]: 0.6 } });
  return out;
}

export const LOAD_COMBINATIONS: readonly LoadCombination[] = expand();

/** The combinations whose basic cases all ran. */
export function combinationsFor(cases: readonly BasicCase[]): LoadCombination[] {
  const have = new Set(cases);
  return LOAD_COMBINATIONS.filter((c) => Object.keys(c.factors).every((k) => have.has(k as BasicCase)));
}
