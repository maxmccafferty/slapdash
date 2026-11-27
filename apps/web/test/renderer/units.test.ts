/** Window and door units in the renderer and the model store (LOC-124). */
import { afterEach, describe, expect, it } from 'vitest';
import type { MeshStandardMaterial } from 'three';
import { CommandBus, createProject, formatErrors, indexCatalog, isUnitPart, unitPartsOf } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { batchKey, groupParts, partLook } from '../../src/renderer/batches.ts';
import { createCutUniforms } from '../../src/renderer/CutFaces.ts';
import { getPartMaterials, unitSwatch } from '../../src/renderer/materials.ts';
import { resetModelStore, useModelStore } from '../../src/state/model-store.ts';
import { sampleBus, sampleProject } from './fixtures.ts';

afterEach(() => resetModelStore());

const idx = indexCatalog(CATALOG);

describe('unit batches', () => {
  const project = sampleProject();

  it('keys unit pieces by their look, and leaves other parts alone', () => {
    const glass = Object.values(project.parts).find((p) => p.role === 'glass')!;
    const jamb = Object.values(project.parts).find((p) => p.tags.includes('unit:jamb'))!;
    const stud = project.parts['W1-S03']!;
    expect(partLook(glass)).toBe('glass');
    expect(partLook(jamb)).toBe('frame');
    expect(partLook(stud)).toBeNull();
    expect(batchKey(glass)).toBe('opening-unit|none|glass');
    expect(batchKey(jamb)).toBe('opening-unit|none|frame');
    expect(batchKey(stud)).toBe('spf-no2|2x4');
    for (const b of groupParts(project)) expect(b.parts.every((p) => partLook(p) === b.look)).toBe(true);
  });

  it('twenty windows of one product are still a handful of batches', () => {
    const bus = new CommandBus({ project: createProject({ name: 'Windows' }), catalog: CATALOG });
    const exec = (name: string, input: unknown) => {
      const res = bus.execute(name, input);
      if (!res.ok) throw new Error(`${name}: ${formatErrors(res.errors)}`);
    };
    exec('pour_slab', { from: { x: 0, z: 0 }, to: { x: '100ft', z: '10ft' } });
    exec('build_wall', {
      start: { x: 0, z: 0 },
      end: { x: '100ft', z: 0 },
      height: '9ft',
      openings: Array.from({ length: 20 }, (_, i) => ({ kind: 'window', centerAt: `${3 + i * 4.8}ft`, width: '24in', product: 'window-casement' })),
    });
    const unit = groupParts(bus.project).filter((b) => b.materialId === 'window-casement');
    expect(unit.reduce((n, b) => n + b.parts.length, 0)).toBeGreaterThan(200);
    expect(unit.length).toBeLessThanOrEqual(4);
  });
});

describe('unit materials', () => {
  const cut = createCutUniforms();
  const req = { mode: 'textured' as const, tier: 'high' as const, cut, catalog: idx, gl: null, onLoad: () => {} };

  it('glass is transparent with no depth write; the frame is opaque in its finish', () => {
    const glass = getPartMaterials({ ...req, materialId: 'window-casement', look: 'glass' });
    expect(glass.transparent).toBe(true);
    expect(glass.material.transparent).toBe(true);
    expect(glass.material.depthWrite).toBe(false);
    const frame = getPartMaterials({ ...req, materialId: 'window-casement', look: 'frame' });
    expect(frame.transparent).toBe(false);
    expect((frame.material as MeshStandardMaterial).color.getHexString()).toBe('f4f4f0');
    const slab = getPartMaterials({ ...req, materialId: 'door-entry', look: 'door' });
    expect((slab.material as MeshStandardMaterial).color.getHexString()).toBe('7a4b2a');
  });

  it('a product without a unit uses the default unit; stress mode ignores the look', () => {
    expect(unitSwatch(undefined, 'glass').opacity).toBeLessThan(1);
    expect(unitSwatch(undefined, 'frame').color).toBe('#f4f4f0');
    const ghost = getPartMaterials({ ...req, mode: 'stress', materialId: 'window-casement', look: 'glass' });
    const ghost2 = getPartMaterials({ ...req, mode: 'stress', materialId: 'window-casement', look: 'frame' });
    expect(ghost).toBe(ghost2);
  });
});

describe('selecting a unit', () => {
  it('a glass part selects its whole unit, and the selection survives a re-size', () => {
    const bus = sampleBus();
    useModelStore.getState().attachBus(bus);
    const window = Object.values(bus.project.parts).find((p) => p.role === 'glass' && p.tags.includes('window'))!;
    const opening = window.assemblyId;
    useModelStore.getState().select(window.id);
    const s = useModelStore.getState();
    expect(s.selectedPartId).toBe(window.id);
    expect(s.selectedUnitId).toBe(opening);
    expect(s.selectedPartLabel).toBe("Casement window 3' × 4', Window in East wall");

    const res = bus.execute('update_opening', { openingId: opening, width: '30in' });
    if (!res.ok) throw new Error(formatErrors(res.errors));
    const after = useModelStore.getState();
    expect(after.selectedUnitId).toBe(opening);
    expect(after.selectedPartId).not.toBeNull();
    expect(bus.project.parts[after.selectedPartId!]).toBeDefined();
    expect(isUnitPart(bus.project.parts[after.selectedPartId!]!)).toBe(true);
    if (!bus.project.parts[window.id]) expect(after.selectedPartId).toBe(unitPartsOf(bus.project, opening)[0]!.id);
    expect(after.selectedPartLabel).toContain("2' 6\" × 4'");
  });

  it('an ordinary part has no unit', () => {
    useModelStore.getState().attachBus(sampleBus());
    useModelStore.getState().select('W3-H01');
    expect(useModelStore.getState().selectedUnitId).toBeNull();
  });
});
