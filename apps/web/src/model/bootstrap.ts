/**
 * Creates the command bus the app works on and points the model store at it. Until the
 * ProjectStore is wired in, the app starts on an empty project; `?sample=pool-house` builds
 * the acceptance-test shell instead (add `&context=1` for a stippled house and tree), and
 * `openSampleProject()` swaps it in later.
 */
import { CommandBus, createProject } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { useModelStore } from '../state/model-store.ts';
import { useSiteStore } from '../state/site-store.ts';
import { buildSampleShell } from './sample-shell.ts';

export interface BootstrapResult {
  bus: CommandBus;
  detach: () => void;
}

let current: BootstrapResult | null = null;

/** Builders size headers and footings from the same resolved loads the solver checks. */
const siteDefaults = () => useSiteStore.getState().siteDefaults;

/** Point the model store at a new bus, letting go of the previous one. */
function attach(bus: CommandBus): BootstrapResult {
  const previous = current;
  const detach = useModelStore.getState().attachBus(bus);
  previous?.detach();
  current = { bus, detach };
  return current;
}

function buildSample(bus: CommandBus, context: boolean) {
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
