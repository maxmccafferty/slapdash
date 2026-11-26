/**
 * Creates the command bus the app works on and points the model store at it. Until the
 * ProjectStore is wired in, the app starts on an empty project; `?sample=pool-house` builds
 * the acceptance-test shell instead (add `&context=1` for a stippled house and tree).
 */
import { CommandBus, createProject } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { useModelStore } from '../state/model-store.ts';
import { buildSampleShell } from './sample-shell.ts';

export interface BootstrapResult {
  bus: CommandBus;
  detach: () => void;
}

export function bootstrapModel(search: string = typeof window === 'undefined' ? '' : window.location.search): BootstrapResult {
  const params = new URLSearchParams(search);
  const sample = params.get('sample');
  const bus = new CommandBus({
    project: createProject({ name: sample === 'pool-house' ? 'Pool house' : 'New project' }),
    catalog: TIER1_CATALOG,
  });
  const store = useModelStore.getState();
  const detach = store.attachBus(bus);
  if (sample === 'pool-house') {
    // Built after attaching, as Claude would: each command's parts drop in and are outlined briefly.
    buildSampleShell(bus, { context: params.get('context') === '1', onCreated: (ids) => store.markInProgress(ids) });
  }
  return { bus, detach };
}
