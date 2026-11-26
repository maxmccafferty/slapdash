/**
 * Runs the structural analysis for the stress view. While Stress is on in 3D it analyses
 * the project 300 ms after it (or the site defaults) last changed, on the solver's
 * `'view'` channel. The last result stays on screen while a new one runs; a request
 * superseded by a newer one is ignored. In 2D it pauses. Each switch-on is counted so
 * the automatic explain turn runs once per switch-on.
 *
 * `watchStressAnalysis` is the framework-free part (tests drive it directly);
 * `useStressAnalysis` mounts it once, in `ModelArea`.
 */
import type { Project, SiteDefaults } from '@slapdash/core';
import type { AnalysisResult } from '@slapdash/solver';
import { useEffect } from 'react';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { useSiteStore } from '../state/site-store.ts';
import { analyzeProject } from './solver.ts';
import { useStressStore } from './stress-store.ts';

export const STRESS_DEBOUNCE_MS = 300;

export type StressAnalyzer = (project: Project, siteDefaults: SiteDefaults) => Promise<AnalysisResult>;

const viewAnalyzer: StressAnalyzer = (project, siteDefaults) => analyzeProject(project, { siteDefaults }, 'view');
let defaultAnalyzer: StressAnalyzer = viewAnalyzer;

/** Tests (jsdom has no worker): analyse in-thread instead. Null restores the worker. */
export function setStressAnalyzer(analyze: StressAnalyzer | null): void {
  defaultAnalyzer = analyze ?? viewAnalyzer;
}

export function watchStressAnalysis(opts: { analyze?: StressAnalyzer; debounceMs?: number } = {}): () => void {
  const analyze: StressAnalyzer = opts.analyze ?? ((p, d) => defaultAnalyzer(p, d));
  const debounceMs = opts.debounceMs ?? STRESS_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requested: { project: Project; siteDefaults: SiteDefaults } | null = null;
  let seq = 0;

  const active = () => {
    const s = useShellStore.getState();
    return s.stress && s.view === '3d';
  };

  const run = async () => {
    timer = null;
    const project = useModelStore.getState().project;
    const siteDefaults = useSiteStore.getState().siteDefaults;
    if (!project || !active()) return;
    const mine = ++seq;
    requested = { project, siteDefaults };
    useStressStore.setState({ status: 'running', error: null });
    try {
      const result = await analyze(project, siteDefaults);
      if (mine !== seq) return;
      useStressStore.setState({ status: 'ready', result, forProject: project, error: null });
    } catch (e) {
      // Superseded by a newer request (StaleSolverRequest; matched by name to keep the client lazy).
      if ((e instanceof Error && e.name === 'StaleSolverRequest') || mine !== seq) return;
      useStressStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  const schedule = (immediate = false) => {
    if (timer) clearTimeout(timer);
    if (!active()) {
      timer = null;
      return;
    }
    const s = useModelStore.getState();
    const site = useSiteStore.getState().siteDefaults;
    // Nothing changed since the last request (e.g. back from 2D): keep the result.
    if (requested && requested.project === s.project && requested.siteDefaults === site && useStressStore.getState().status !== 'error') return;
    timer = setTimeout(() => void run(), immediate ? 0 : debounceMs);
  };

  const offShell = useShellStore.subscribe((s, prev) => {
    if (s.stress && !prev.stress) useStressStore.setState((st) => ({ switchOn: st.switchOn + 1 }));
    if (s.stress !== prev.stress || s.view !== prev.view) {
      if (!s.stress) {
        // Off: forget the request so switching on again re-analyses and explains afresh.
        seq++;
        requested = null;
        useStressStore.setState({ status: 'idle' });
      }
      schedule(true);
    }
  });
  const offModel = useModelStore.subscribe((s, prev) => {
    if (s.project !== prev.project) schedule();
  });
  const offSite = useSiteStore.subscribe((s, prev) => {
    if (s.siteDefaults !== prev.siteDefaults) schedule();
  });
  if (useShellStore.getState().stress) {
    useStressStore.setState((st) => ({ switchOn: st.switchOn + 1 }));
    schedule(true);
  }

  return () => {
    offShell();
    offModel();
    offSite();
    if (timer) clearTimeout(timer);
    seq++;
  };
}

export function useStressAnalysis(): void {
  useEffect(() => watchStressAnalysis(), []);
}
