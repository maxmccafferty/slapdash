import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBus, createProject, formatErrors } from '@slapdash/core';
import { TIER1_CATALOG } from '@slapdash/catalog';
import { bootstrapModel } from '../../src/model/bootstrap.ts';
import { floorStops, projectSummary } from '../../src/model/floor-stops.ts';
import { PLACEHOLDER_FLOORS, PLACEHOLDER_PROJECT } from '../../src/placeholder.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { sampleBus } from './fixtures.ts';

afterEach(() => {
  resetModelStore();
  vi.useRealTimers();
});

describe('model store', () => {
  it('follows the bus through execute and undo', () => {
    const bus = new CommandBus({ project: createProject({ name: 'T' }), catalog: TIER1_CATALOG });
    const detach = useModelStore.getState().attachBus(bus);
    expect(useModelStore.getState().project).toBe(bus.project);
    expect(useModelStore.getState().lastEvent).toBe('load');
    const res = bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '10ft' } });
    if (!res.ok) throw new Error(formatErrors(res.errors));
    expect(useModelStore.getState().project).toBe(bus.project);
    expect(useModelStore.getState().lastEvent).toBe('execute');
    expect(Object.keys(useModelStore.getState().project!.parts).length).toBeGreaterThan(0);
    bus.undo();
    expect(useModelStore.getState().project).toBe(bus.project);
    expect(useModelStore.getState().lastEvent).toBe('undo');
    expect(Object.keys(useModelStore.getState().project!.parts)).toHaveLength(0);
    detach();
    bus.redo();
    expect(Object.keys(useModelStore.getState().project!.parts)).toHaveLength(0);
  });

  it('selects a part with its label, and clears the selection when the part is deleted', () => {
    const bus = sampleBus();
    useModelStore.getState().attachBus(bus);
    useModelStore.getState().select('W3-H01');
    expect(useModelStore.getState().selectedPartLabel).toBe('Header, South wall');
    const res = bus.execute('delete_parts', { ids: ['W3-H01'] });
    if (!res.ok) throw new Error(formatErrors(res.errors));
    expect(useModelStore.getState().selectedPartId).toBeNull();
    expect(useModelStore.getState().selectedPartLabel).toBeNull();
  });

  it('ignores a selection of a part that does not exist', () => {
    useModelStore.getState().attachBus(sampleBus());
    useModelStore.getState().select('W9-S99');
    expect(useModelStore.getState().selectedPartId).toBeNull();
  });

  it('marks parts in progress for a while', () => {
    vi.useFakeTimers();
    useModelStore.getState().attachBus(sampleBus());
    useModelStore.getState().markInProgress(['W1-S01', 'W1-S02'], 600);
    expect([...useModelStore.getState().inProgress]).toEqual(['W1-S01', 'W1-S02']);
    vi.advanceTimersByTime(601);
    expect(useModelStore.getState().inProgress.size).toBe(0);
  });

  it('bootstrap builds the pool-house sample and outlines what each command made', () => {
    const { bus, detach } = bootstrapModel('?sample=pool-house');
    expect(useModelStore.getState().project).toBe(bus.project);
    expect(useModelStore.getState().project!.name).toBe('Pool house');
    expect(useModelStore.getState().inProgress.size).toBeGreaterThan(100);
    expect(bus.listHistory()).toHaveLength(1);
    detach();
  });

  it('bootstrap without a sample opens an empty project', () => {
    const { detach } = bootstrapModel('');
    expect(Object.keys(useModelStore.getState().project!.parts)).toHaveLength(0);
    detach();
  });
});

describe('floor stops and the header', () => {
  it('fall back to the placeholders without a model', () => {
    expect(floorStops(null)).toBe(PLACEHOLDER_FLOORS);
    expect(projectSummary(null)).toBe(PLACEHOLDER_PROJECT);
  });

  it('come from the model: foundation top, wall top, ridge', () => {
    const project = sampleBus({ context: true }).project;
    expect(floorStops(project).map((s) => `${s.label} ${s.height}`)).toEqual(['Roof 13′ 10″', 'Floor 1 9′ 4″', 'Foundation 0′ 4″']);
    const parts = projectSummary(project).specs.find((s) => s.label === 'Parts')!.value;
    // Site context isn't counted.
    expect(Number(parts)).toBe(Object.values(project.parts).filter((p) => !p.tags.includes('site-context')).length);
  });

  it('keep the placeholder for a stop with nothing built', () => {
    const bus = new CommandBus({ project: createProject({ name: 'T' }), catalog: TIER1_CATALOG });
    bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '10ft', z: '10ft' } });
    const stops = floorStops(bus.project);
    expect(stops[0]).toBe(PLACEHOLDER_FLOORS[0]);
    expect(stops[2]!.height).toBe('0′ 4″');
  });
});
