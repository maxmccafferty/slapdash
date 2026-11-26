/**
 * Renders snapshots inside the same WebGL context as the user's view, so textures and
 * programs are shared (a second context is expensive on iOS). For each request it mounts
 * the scene into a separate `THREE.Scene` via a portal, waits for it (commit, textures,
 * fonts, shader compile), renders each tile with its own camera into a render target,
 * reads the pixels back and unmounts. The user's camera, controls and scene are never
 * touched.
 */
import { createPortal, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Color,
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Mesh,
  type WebGLRenderer,
} from 'three';
import type { CatalogIndex, Project } from '@slapdash/core';
import { SCENE_COLORS } from '../../styles/tokens.ts';
import { createCutUniforms, type CutUniforms } from '../CutFaces.ts';
import { scaleScreenSprites, whenFontsReady } from '../labels.ts';
import { useRendererStore } from '../renderer-store.ts';
import { SceneContent, type ViewSpec } from '../SceneContent.tsx';
import { texturesSettled } from '../textures.ts';
import { isKindVisible } from '../visibility.ts';
import { composePng, type LabelRequest } from './compose.ts';
import { idBounds, planSnapshot, type TileCamera, type TilePlan } from './plan.ts';
import { registerSnapshotRenderer } from './registry.ts';
import { expandIds, type RenderableMode, type SnapshotRequest, type SnapshotResult } from './types.ts';

interface Job {
  project: Project;
  catalog: CatalogIndex | null;
  spec: ViewSpec;
  cut: CutUniforms;
  onMounted: () => void;
}

function Mounted({ onMounted }: { onMounted: () => void }) {
  // Last child of the portal: its layout effect runs after every sibling's.
  useLayoutEffect(onMounted, [onMounted]);
  return null;
}

function makeCamera(c: TileCamera): Camera {
  if (c.kind === 'ortho') {
    const cam = new OrthographicCamera(c.left, c.right, c.top, c.bottom, c.near, c.far);
    cam.position.set(c.position.x, c.position.y, c.position.z);
    cam.up.set(c.up.x, c.up.y, c.up.z);
    cam.lookAt(c.target.x, c.target.y, c.target.z);
    cam.updateMatrixWorld();
    return cam;
  }
  const cam = new PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
  cam.position.set(c.position.x, c.position.y, c.position.z);
  cam.up.set(c.up.x, c.up.y, c.up.z);
  cam.lookAt(c.target.x, c.target.y, c.target.z);
  cam.updateMatrixWorld();
  return cam;
}

/** ID labels: the highlighted parts (or assemblies), else every assembly, at their centres (metres). */
function labelAnchors(req: SnapshotRequest, project: Project): { text: string; at: Vector3 }[] {
  if (!req.labels) return [];
  const ids = req.highlight.length > 0
    ? req.highlight
    : Object.values(project.assemblies)
        .filter((a) => isKindVisible(a.kind, { floor: req.floor, lookFrom: req.lookFrom }))
        .map((a) => a.id);
  const out: { text: string; at: Vector3 }[] = [];
  for (const id of ids) {
    const box = idBounds(project, id);
    if (!box) continue;
    out.push({ text: id, at: new Vector3((box.min.x + box.max.x) / 2000, (box.min.y + box.max.y) / 2000, (box.min.z + box.max.z) / 2000) });
  }
  return out;
}

function projectLabels(anchors: { text: string; at: Vector3 }[], tile: TilePlan, camera: Camera): LabelRequest[] {
  const out: LabelRequest[] = [];
  for (const a of anchors) {
    const v = a.at.clone().project(camera);
    if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
    out.push({ text: a.text, x: tile.rect.x + ((v.x + 1) / 2) * tile.rect.w, y: tile.rect.y + ((1 - v.y) / 2) * tile.rect.h });
  }
  return out;
}

function notesFor(req: SnapshotRequest): string[] {
  const notes: string[] = [];
  if (req.lookFrom === 'inside') notes.push('Looking from inside: the roof is hidden and walls are cut at 4′ 0″.');
  if (req.floor === 'foundation') notes.push('Only the foundation and site are shown (Floors: Foundation).');
  if (req.floor === 'floor-1') notes.push('The roof is hidden (Floors: Floor 1).');
  if (req.mode === 'blueprint') notes.push('Blueprint: parts drawn as ink edges on white.');
  if (req.mode === 'xray') notes.push('X-ray: parts drawn see-through, so hidden framing shows.');
  return notes;
}

/** Render every tile into one render target, read it back and compose the PNG. */
async function renderTiles(
  gl: WebGLRenderer,
  scene: Scene,
  req: SnapshotRequest & { mode: RenderableMode },
  project: Project,
): Promise<SnapshotResult> {
  const plan = planSnapshot(req, project);
  const cameras = plan.tiles.map((t) => makeCamera(t.camera));
  for (const cam of cameras) await gl.compileAsync(scene, cam);

  const rt = new WebGLRenderTarget(plan.width, plan.height, { samples: 4 });
  rt.texture.colorSpace = SRGBColorSpace;
  const previousTarget = gl.getRenderTarget();
  const previousClear = gl.getClearColor(new Color());
  const previousAlpha = gl.getClearAlpha();
  const pixels = new Uint8Array(plan.width * plan.height * 4);
  const anchors = labelAnchors(req, project);
  const labels: LabelRequest[] = [];
  try {
    gl.setClearColor(SCENE_COLORS.paper, 1);
    plan.tiles.forEach((tile, i) => {
      const cam = cameras[i]!;
      const glY = plan.height - tile.rect.y - tile.rect.h;
      rt.viewport.set(tile.rect.x, glY, tile.rect.w, tile.rect.h);
      rt.scissor.set(tile.rect.x, glY, tile.rect.w, tile.rect.h);
      rt.scissorTest = true;
      gl.setRenderTarget(rt);
      gl.clear();
      scaleScreenSprites(scene, cam, tile.rect.h);
      scene.traverse((obj) => {
        const m = (obj as Mesh).material as (Material & { isLineMaterial?: boolean; resolution?: { set: (w: number, h: number) => void } }) | undefined;
        if (m && !Array.isArray(m) && m.isLineMaterial) m.resolution?.set(tile.rect.w, tile.rect.h);
      });
      gl.render(scene, cam);
      labels.push(...projectLabels(anchors, tile, cam));
    });
    gl.readRenderTargetPixels(rt, 0, 0, plan.width, plan.height, pixels);
  } finally {
    gl.setRenderTarget(previousTarget);
    gl.setClearColor(previousClear, previousAlpha);
    rt.dispose();
  }

  const png = await composePng({
    pixels,
    width: plan.width,
    height: plan.height,
    tiles: plan.tiles.map((t) => ({ caption: t.caption, rect: t.rect, north: t.north })),
    labels,
  });
  return { png, width: plan.width, height: plan.height, angle: plan.angle, mode: req.mode, notes: notesFor(req) };
}

export function SnapshotHost() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [job, setJob] = useState<Job | null>(null);
  const scene = useMemo(() => {
    const s = new Scene();
    s.background = new Color(SCENE_COLORS.paper);
    return s;
  }, []);

  useEffect(
    () =>
      registerSnapshotRenderer(async (req, project, catalog): Promise<SnapshotResult> => {
        await whenFontsReady();
        const outlined = expandIds(project, req.highlight);
        let onMounted!: () => void;
        const mounted = new Promise<void>((resolve) => (onMounted = resolve));
        const spec: ViewSpec = {
          mode: req.mode,
          floor: req.floor,
          lookFrom: req.lookFrom,
          dimensions: req.dimensions,
          outlined,
          proposal: null,
        };
        setJob({ project, catalog, spec, cut: createCutUniforms(), onMounted });
        try {
          await mounted;
          await texturesSettled();
          return await renderTiles(gl, scene, req, project);
        } finally {
          setJob(null);
          invalidate();
        }
      }),
    [gl, scene, invalidate],
  );

  const tier = useRendererStore((s) => s.tier);
  if (!job) return null;
  return createPortal(
    <>
      <SceneContent project={job.project} catalog={job.catalog} spec={job.spec} cut={job.cut} tier={tier} />
      <Mounted onMounted={job.onMounted} />
    </>,
    scene,
  );
}
