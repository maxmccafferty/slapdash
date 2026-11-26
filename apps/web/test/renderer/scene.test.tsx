/**
 * The scene graph, without WebGL (@react-three/test-renderer): one instanced mesh per
 * batch, the view controls change instance counts, and orange is only ever an outline.
 */
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Color, type InstancedMesh, type Material, type Mesh, type Object3D } from 'three';
import { analyze } from '@slapdash/solver';
import { calloutText, mostLoaded } from '../../src/analysis/stress.ts';
import { isStressChecked, UNCHECKED_OPACITY } from '../../src/renderer/materials.ts';
import { STRESS_FILL } from '../../src/renderer/PartBatch.tsx';
import { stressSpec } from '../../src/renderer/stress-spec.ts';
import { MAX_STRESS_MARKS } from '../../src/renderer/StressCallout.tsx';
import { indexCatalog } from '@slapdash/core';
import { CATALOG } from '@slapdash/catalog';
import { groupParts } from '../../src/renderer/batches.ts';
import { createCutUniforms } from '../../src/renderer/CutFaces.ts';
import { SceneContent, type ViewSpec } from '../../src/renderer/SceneContent.tsx';
import { setTextureLoadingEnabled } from '../../src/renderer/textures.ts';
import { sampleProject } from './fixtures.ts';

const project = sampleProject();
const catalog = indexCatalog(CATALOG);
const base: ViewSpec = { mode: 'textured', floor: 'roof', lookFrom: 'outside', dimensions: false, outlined: [], proposal: null };

// jsdom has no 2D canvas; labels and the compass skip drawing.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  setTextureLoadingEnabled(false);
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

async function render(spec: Partial<ViewSpec> = {}) {
  const cut = createCutUniforms();
  const r = await ReactThreeTestRenderer.create(
    <SceneContent project={project} catalog={catalog} spec={{ ...base, ...spec }} cut={cut} tier="high" />,
  );
  return { r, cut };
}

function batchMeshes(scene: Object3D): InstancedMesh[] {
  const parts = scene.getObjectByName('parts')!;
  return parts.children.filter((c): c is InstancedMesh => (c as InstancedMesh).isInstancedMesh);
}

/** Visible instances per assembly kind. */
function kinds(scene: Object3D): Record<string, number> {
  const out: Record<string, number> = {};
  for (const mesh of batchMeshes(scene)) {
    for (const id of mesh.userData.partIds as string[]) {
      const kind = project.assemblies[project.parts[id]!.assemblyId]!.kind;
      out[kind] = (out[kind] ?? 0) + 1;
    }
  }
  return out;
}

const colourOf = (m: Material) => ((m as Material & { color?: { getHexString(): string } }).color?.getHexString() ?? null);

describe('SceneContent', () => {
  it('draws one instanced mesh per batch, with every part', async () => {
    const { r } = await render();
    const scene = r.scene.instance;
    const meshes = batchMeshes(scene);
    expect(meshes.map((m) => m.name.replace('batch:', ''))).toEqual(groupParts(project).map((b) => b.key));
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(Object.keys(project.parts).length);
    for (const m of meshes) expect(m.instanceMatrix.count).toBeGreaterThanOrEqual(m.count);
    await r.unmount();
  });

  it('Floors = Foundation leaves only the slab and footings', async () => {
    const { r } = await render({ floor: 'foundation' });
    expect(kinds(r.scene.instance)).toEqual({ foundation: 5 });
    await r.unmount();
  });

  it('Floors = Floor 1 hides the roof', async () => {
    const { r } = await render({ floor: 'floor-1' });
    const k = kinds(r.scene.instance);
    expect(k.roof).toBeUndefined();
    expect(k.wall).toBeGreaterThan(0);
    await r.unmount();
  });

  it('Inside removes the roof and turns the cut on at 4′ 0″', async () => {
    const { r, cut } = await render({ lookFrom: 'inside' });
    expect(kinds(r.scene.instance).roof).toBeUndefined();
    expect(cut.uCutActive.value).toBe(1);
    expect(cut.uCutY.value).toBeCloseTo(1.2192, 6);
    // Walls are flagged cuttable, the slab is not.
    const studs = batchMeshes(r.scene.instance).find((m) => m.name === 'batch:spf-no2|2x4')!;
    const flags = studs.userData.cuttable as boolean[];
    expect(flags.every(Boolean)).toBe(true);
    const slab = batchMeshes(r.scene.instance).find((m) => m.name === 'batch:concrete-3000|none')!;
    expect((slab.userData.cuttable as boolean[]).some(Boolean)).toBe(false);
    await r.unmount();
  });

  it('updates in place when the view changes', async () => {
    const cut = createCutUniforms();
    const r = await ReactThreeTestRenderer.create(<SceneContent project={project} catalog={catalog} spec={base} cut={cut} tier="high" />);
    const before = batchMeshes(r.scene.instance);
    await r.update(<SceneContent project={project} catalog={catalog} spec={{ ...base, floor: 'foundation' }} cut={cut} tier="high" />);
    const after = batchMeshes(r.scene.instance);
    // Same mesh objects: hidden parts are compacted out of the count, nothing is remounted.
    expect(after).toEqual(before);
    expect(kinds(r.scene.instance)).toEqual({ foundation: 5 });
    await r.unmount();
  });

  it('a selection adds an orange outline and changes no material colour', async () => {
    const { r } = await render();
    const colours = batchMeshes(r.scene.instance).map((m) => colourOf(m.material as Material));
    expect(r.scene.instance.getObjectByName('outline')).toBeUndefined();
    await act(async () => {
      await r.update(<SceneContent project={project} catalog={catalog} spec={{ ...base, outlined: ['W3-H01'] }} cut={createCutUniforms()} tier="high" />);
    });
    const outline = r.scene.instance.getObjectByName('outline') as Mesh | undefined;
    expect(outline).toBeDefined();
    const material = outline!.material as Material & { color: { getHexString(): string }; dashed?: boolean };
    expect(`#${material.color.getHexString()}`).toBe('#e8590c');
    expect(material.depthTest).toBe(false);
    const after = batchMeshes(r.scene.instance).map((m) => colourOf(m.material as Material));
    expect(after).toEqual(colours);
    expect(after).not.toContain('e8590c');
    await r.unmount();
  });

  it('a proposal is a dashed orange box', async () => {
    const { r } = await render({ proposal: { footprint: { from: { x: 0, z: 0 }, to: { x: 3000, z: 2000 } }, height_mm: 2400 } });
    const line = r.scene.instance.getObjectByName('proposal') as Mesh | undefined;
    expect(line).toBeDefined();
    const material = line!.material as Material & { dashed: boolean; color: { getHexString(): string } };
    expect(material.dashed).toBe(true);
    expect(`#${material.color.getHexString()}`).toBe('#e8590c');
    await r.unmount();
  });

  it('draws dimensions when asked', async () => {
    const { r } = await render({ dimensions: true });
    const dims = r.scene.instance.getObjectByName('dimensions');
    expect(dims).toBeDefined();
    const labels = dims!.children.filter((c) => c.type === 'Sprite');
    expect(labels.length).toBeGreaterThanOrEqual(6);
    await r.unmount();
  });

  it('draws site context stippled, outside the batches', async () => {
    const { sampleBus } = await import('./fixtures.ts');
    const withContext = sampleBus({ context: true }).project;
    const r = await ReactThreeTestRenderer.create(
      <SceneContent project={withContext} catalog={catalog} spec={base} cut={createCutUniforms()} tier="high" />,
    );
    const context = r.scene.instance.getObjectByName('site-context')!;
    expect(context.children.length).toBeGreaterThan(0);
    const ids = batchMeshes(r.scene.instance).flatMap((m) => m.userData.partIds as string[]);
    expect(ids.some((id) => withContext.parts[id]!.tags.includes('stippled'))).toBe(false);
    await r.unmount();
  });

  it('stress mode: checked parts get instance fills, unchecked ones the ghost, and the callout sits on the worst part', async () => {
    const result = analyze(project, catalog);
    const all = () => true;
    const stress = stressSpec(project, result, all);
    const { r } = await render({ mode: 'stress', stress });
    const scene = r.scene.instance;
    const meshes = batchMeshes(scene);
    let filled = 0;
    let ghosts = 0;
    for (const mesh of meshes) {
      const material = mesh.material as Material & { opacity: number; transparent: boolean };
      const hatch = mesh.geometry.getAttribute('aHatch');
      if (isStressChecked(catalog.materials.get(project.parts[(mesh.userData.partIds as string[])[0]!]!.materialId))) {
        expect(mesh.instanceColor, mesh.name).not.toBeNull();
        const c = new Color();
        (mesh.userData.partIds as string[]).forEach((id, i) => {
          const band = stress.bands.get(id)!;
          mesh.getColorAt(i, c);
          expect(`#${c.getHexString()}`, id).toBe(new Color(STRESS_FILL[band]).getHexString().replace(/^/, '#'));
          expect(hatch.getX(i), id).toBe(band === 'over' ? 1 : 0);
        });
        filled++;
      } else {
        expect(material.transparent).toBe(true);
        expect(material.opacity).toBeCloseTo(UNCHECKED_OPACITY);
        ghosts++;
      }
    }
    expect(filled).toBeGreaterThan(0);
    expect(ghosts).toBeGreaterThan(0);
    const worst = mostLoaded(result, project, all)!;
    const callout = scene.getObjectByName('stress-callout')!;
    expect(callout.userData).toMatchObject({ partId: worst.id, text: calloutText(worst.label, worst.utilization), over: worst.utilization > 1 });
    // No orange outline appears for stress; orange stays selection.
    expect(scene.getObjectByName('outline')).toBeUndefined();
    await r.unmount();
  });

  it('stress mode marks over-limit parts (at most 20)', async () => {
    const result = analyze(project, catalog);
    const bands = new Map(Object.keys(project.parts).map((id) => [id, 'over' as const]));
    const { r } = await render({ mode: 'stress', stress: { bands, callout: null } });
    const marks = r.scene.instance.getObjectByName('stress-marks')!;
    expect((marks.userData.partIds as string[]).length).toBe(MAX_STRESS_MARKS);
    expect(result.status).toBe('ok');
    await r.unmount();
  });
});
