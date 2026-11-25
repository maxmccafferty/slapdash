/**
 * The stress legend (ADR-0003 §C, §J1): shown only while Stress is on in 3D. The five
 * bands, "Over limit" and "Not checked"; the analysis status; the design loads with where
 * each came from (the person's own numbers get the orange dot and "Yours", the way their
 * prices do; they're not editable here, Claude sets them); and the planning-estimate
 * disclaimer. `layout="compact"` (phone) folds the loads under a "Loads" disclosure.
 */
import { DESIGN_LOAD_KEYS, formatLoad, resolveDesignLoads, type DesignLoadKey, type Project, type SiteDefaults } from '@slapdash/core';
import type { AnalysisResult } from '@slapdash/solver';
import { Icon } from '../components/Icon.tsx';
import { STRESS_BANDS } from '../analysis/stress.ts';
import { useStressStore, type StressStatus } from '../analysis/stress-store.ts';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { useSiteStore } from '../state/site-store.ts';
import styles from './StressLegend.module.css';

export const LEGEND_DISCLAIMER = 'Planning estimate, not an engineering check.';

const LOAD_NAMES: Record<DesignLoadKey, string> = { groundSnow: 'Snow', windSpeed: 'Wind', frostDepth: 'Frost' };

export interface LegendLoad {
  key: DesignLoadKey;
  name: string;
  value: string | null;
  source: string | null;
  yours: boolean;
}

/** The location line and each load as the legend shows it. */
export function legendLoads(project: Project, defaults: SiteDefaults, result: AnalysisResult | null): { location: string; loads: LegendLoad[] } {
  const site = resolveDesignLoads(project, defaults);
  const loc = site.location;
  const location = !loc
    ? 'No location set'
    : !site.locationInTable
      ? `${loc.label} · not in the loads table`
      : `${loc.label} · ${loc.source === 'project' ? 'yours' : 'default'}`;
  const loads = DESIGN_LOAD_KEYS.map((key): LegendLoad => {
    const v = site.loads[key];
    if (v) return { key, name: LOAD_NAMES[key], value: formatLoad(key, v.value), source: v.source, yours: v.origin === 'project' };
    // Snow and wind fall back to the solver's defaults, which say why.
    const solver = key === 'groundSnow' ? result?.loads.groundSnow : key === 'windSpeed' ? result?.loads.windSpeed : undefined;
    if (solver) return { key, name: LOAD_NAMES[key], value: formatLoad(key, solver.value), source: solver.source, yours: false };
    return { key, name: LOAD_NAMES[key], value: null, source: null, yours: false };
  });
  return { location, loads };
}

function statusText(status: StressStatus, result: AnalysisResult | null, error: string | null): string | null {
  if (status === 'running' || (status !== 'error' && !result)) return 'Checking…';
  if (status === 'error') return `The check didn't run: ${error ?? 'unknown error'}`;
  if (!result) return null;
  if (result.status === 'mechanism') return result.mechanism?.message ?? "Something isn't held at all, so nothing could be checked.";
  if (result.unstable.length > 0) return result.unstable.map((u) => u.message).join(' ');
  return null;
}

function Loads({ project, defaults, result }: { project: Project; defaults: SiteDefaults; result: AnalysisResult | null }) {
  const { location, loads } = legendLoads(project, defaults, result);
  return (
    <div className={styles.loads} data-testid="stress-loads">
      <span className={styles['loads-title']}>Design loads</span>
      <span className={styles.muted} data-testid="stress-location">
        {location}
      </span>
      {loads.map((l) => (
        <div key={l.key} className={styles.load} data-testid={`stress-load-${l.key}`}>
          <span className={styles['load-value']}>
            {l.yours && <span className={styles['user-dot']} data-user-load="" role="img" aria-label="Your number" />}
            {l.name} {l.value ?? 'not set'}
          </span>
          {l.source && <span className={styles.muted}>{l.yours ? `Yours · ${l.source}` : l.source}</span>}
        </div>
      ))}
    </div>
  );
}

export function StressLegend({ layout = 'full' }: { layout?: 'full' | 'compact' }) {
  const stress = useShellStore((s) => s.stress);
  const view = useShellStore((s) => s.view);
  const project = useModelStore((s) => s.project);
  const defaults = useSiteStore((s) => s.siteDefaults);
  const status = useStressStore((s) => s.status);
  const result = useStressStore((s) => s.result);
  const error = useStressStore((s) => s.error);
  if (!stress || view !== '3d' || !project) return null;

  const line = statusText(status, result, error);
  return (
    <section className={[styles.legend, layout === 'compact' && styles.compact].filter(Boolean).join(' ')} aria-label="Stress" data-testid="stress-legend">
      <span className={styles.title}>Stress</span>
      <ul className={styles.ramp}>
        {STRESS_BANDS.map(({ band, label }) => (
          <li key={band}>
            <span className={[styles.swatch, styles[`band-${band}`]].join(' ')} aria-hidden="true" />
            <span className={styles['swatch-label']}>
              {label}
              {band === 'over' && <Icon name="warning" />}
            </span>
          </li>
        ))}
        <li>
          <span className={[styles.swatch, styles['band-unchecked']].join(' ')} aria-hidden="true" />
          <span className={styles['swatch-label']}>Not checked</span>
        </li>
      </ul>
      {line && (
        <p className={styles.status} role="status" data-testid="stress-status">
          {line}
        </p>
      )}
      {layout === 'compact' ? (
        <details className={styles.disclosure}>
          <summary>Loads</summary>
          <Loads project={project} defaults={defaults} result={result} />
        </details>
      ) : (
        <Loads project={project} defaults={defaults} result={result} />
      )}
      <p className={styles.footer}>{LEGEND_DISCLAIMER}</p>
    </section>
  );
}
