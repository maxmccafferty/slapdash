/**
 * The app's site defaults (ADR-0002 §D3): the default location from the keyhole's
 * `GET /api/claude` (`SLAPDASH_DEFAULT_LOCATION` on the server, never in the bundle) and
 * the bundled loads table. The bus, the solver, Claude's summary and the stress legend
 * all read the same `siteDefaults`, so headers are sized for the loads they're checked
 * against. UI-free.
 */
import { DESIGN_LOAD_TABLE } from '@slapdash/catalog';
import type { SiteDefaults } from '@slapdash/core';
import { create } from 'zustand';

export interface SiteState {
  /** "City, ST" from the keyhole, or null (no keyhole, or none set). */
  defaultLocation: string | null;
  siteDefaults: SiteDefaults;
  setDefaultLocation: (label: string | null) => void;
}

export function siteDefaultsFor(defaultLocation: string | null): SiteDefaults {
  return defaultLocation ? { location: { label: defaultLocation }, table: DESIGN_LOAD_TABLE } : { table: DESIGN_LOAD_TABLE };
}

export const useSiteStore = create<SiteState>()((set) => ({
  defaultLocation: null,
  siteDefaults: siteDefaultsFor(null),
  setDefaultLocation: (label) => {
    const clean = label?.trim() || null;
    set({ defaultLocation: clean, siteDefaults: siteDefaultsFor(clean) });
  },
}));

/** Back to the initial state (tests). */
export function resetSiteStore(): void {
  useSiteStore.setState({ defaultLocation: null, siteDefaults: siteDefaultsFor(null) });
}
