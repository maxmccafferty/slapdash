/**
 * @slapdash/solver — "is it overstressed?" (ADR-0001 §5, ADR-0002 §E5–E6): a linear 3D
 * frame solver with NDS member, joint and shear-panel checks. Pure TypeScript; runs in a
 * Web Worker (`./worker`) or in Node. The Rapier stability sim ("will it tip over?") is a
 * separate entry, `@slapdash/solver/stability`, so this one never loads WASM.
 */
export { analyze, DEFAULT_PERF_BUDGET_MS } from './analyze.ts';
export { DEFAULT_WIND_SPEED_MS, exposureCKz, flatRoofSnow, slopeFactor, velocityPressure } from './loads/site.ts';
export { LOAD_COMBINATIONS, combinationsFor, type LoadCombination } from './loads/combinations.ts';
export { FLOOR_LIVE_KPA, ROOF_LIVE_KPA, WIND_COEFFICIENTS } from './loads/cases.ts';
export * from './types.ts';
