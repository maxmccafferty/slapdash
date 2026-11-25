/**
 * Dev and e2e only (`import.meta.env.DEV` or `?e2e`): `window.__slapdash`, so tests and
 * device checks can drive the app. The renderer and the 2D sheet each add their own keys;
 * neither clobbers the other's. No three.js here, so the shell can import it cheaply.
 */
export function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e');
}

type DebugWindow = { __slapdash?: Record<string, unknown> };

/** Merge `api` into `window.__slapdash` (getters stay getters). Returns a function that removes those keys again. */
export function exposeDebug(api: object): () => void {
  const w = window as unknown as DebugWindow;
  const target = (w.__slapdash ??= {});
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(api));
  const keys = Reflect.ownKeys(api);
  return () => {
    if (w.__slapdash !== target) return;
    for (const key of keys) Reflect.deleteProperty(target, key);
    if (Reflect.ownKeys(target).length === 0) delete w.__slapdash;
  };
}
