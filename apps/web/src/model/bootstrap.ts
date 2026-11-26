/**
 * Points the model store at a command bus. The app's buses come from `ProjectSession`s
 * (`projects/projects-controller.ts`), which call `attach`. `bootstrapModel` and
 * `openSampleProject` make in-memory buses without storage, for tests; `buildSample` runs
 * the pool-house commands on a bus (`?sample=pool-house`, add `&context=1` for a stippled
 * house and tree).
 */
import { CommandBus, createProject } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { useModelStore } from '../state/model-store.ts';
import { useShellStore } from '../state/shell-store.ts';
import { useSiteStore } from '../state/site-store.ts';
import { buildSampleShell } from './sample-shell.ts';

export interface BootstrapResult {
  bus: CommandBus;
  detach: () => void;
}

let current: BootstrapResult | null = null;

/** Builders size headers and footings from the same resolved loads the solver checks. */
export const siteDefaults = () => useSiteStore.getState().siteDefaults;

/** Point the model store at a new bus, letting go of the previous one. */
export function attach(bus: CommandBus): BootstrapResult {
  const previous = current;
  const detach = useModelStore.getState().attachBus(bus);
  previous?.detach();
  // Another project: Build steps start again from the first step.
  useShellStore.getState().setStepIndex(0);
  current = { bus, detach };
  return current;
}

export function buildSample(bus: CommandBus, context: boolean): void {
  // Built after attaching, as Claude would: each command's parts drop in and are outlined briefly.
  buildSampleShell(bus, { context, onCreated: (ids) => useModelStore.getState().markInProgress(ids) });
}

export function bootstrapModel(search: string = typeof window === 'undefined' ? '' : window.location.search): BootstrapResult {
  const params = new URLSearchParams(search);
  const sample = params.get('sample');
  const bus = new CommandBus({
    project: createProject({ name: sample === 'pool-house' ? 'Pool house' : 'New project' }),
    catalog: TIER1_CATALOG,
    siteDefaults,
  });
  const result = attach(bus);
  if (sample === 'pool-house') buildSample(bus, params.get('context') === '1');
  return result;
}

/** Open the sample pool house as a new project (the no-key chat offers it). */
export function openSampleProject(): BootstrapResult {
  const bus = new CommandBus({ project: createProject({ name: 'Pool house' }), catalog: TIER1_CATALOG, siteDefaults });
  const result = attach(bus);
  buildSample(bus, false);
  return result;
}
