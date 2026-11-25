/**
 * Text drawn into the scene (dimension labels, compass letters) as canvas textures, in
 * Geist, so it also appears in snapshots (HTML overlays would not). Screen-sized sprites
 * keep a fixed pixel size: `scaleScreenSprites` sets their scale for a camera and viewport.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace, type Camera, type Object3D, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { LABEL_FONT_FAMILY } from '../styles/fonts.ts';
import { SCENE_COLORS } from '../styles/tokens.ts';

export { LABEL_FONT_FAMILY };
/** Label text size in CSS px (the app's minimum). */
export const LABEL_PX = 14;
/** Canvas texels per CSS px, so labels stay sharp on 3× screens and in large snapshots. */
const OVERSAMPLE = 3;

let fontsReady: Promise<unknown> | null = null;
/** Resolves once Geist is loaded (or immediately where there is no font loading API). */
export function whenFontsReady(): Promise<unknown> {
  if (!fontsReady) {
    fontsReady =
      typeof document !== 'undefined' && document.fonts
        ? Promise.all([document.fonts.load(`600 ${LABEL_PX}px ${LABEL_FONT_FAMILY}`), document.fonts.ready]).catch(() => undefined)
        : Promise.resolve();
  }
  return fontsReady;
}

export function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

export interface LabelTexture {
  texture: CanvasTexture;
  /** Size to draw at, in CSS px. */
  widthPx: number;
  heightPx: number;
}

/** A label: ink text on a paper pill with a hairline border. */
export function makeLabelTexture(text: string): LabelTexture {
  const canvas = document.createElement('canvas');
  const padX = 6;
  const heightPx = 20;
  const ctx = get2d(canvas);
  let widthPx = Math.ceil(text.length * LABEL_PX * 0.6) + padX * 2;
  if (ctx) {
    ctx.font = `600 ${LABEL_PX}px ${LABEL_FONT_FAMILY}`;
    widthPx = Math.ceil(ctx.measureText(text).width) + padX * 2;
  }
  canvas.width = widthPx * OVERSAMPLE;
  canvas.height = heightPx * OVERSAMPLE;
  if (ctx) {
    ctx.scale(OVERSAMPLE, OVERSAMPLE);
    ctx.fillStyle = SCENE_COLORS.paper;
    ctx.strokeStyle = SCENE_COLORS.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, widthPx - 1, heightPx - 1, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = SCENE_COLORS.ink;
    ctx.font = `600 ${LABEL_PX}px ${LABEL_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, widthPx / 2, heightPx / 2 + 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return { texture, widthPx, heightPx };
}

/** Marks an object to be drawn at a fixed size in CSS px. */
export interface ScreenSize {
  widthPx: number;
  heightPx: number;
}

/**
 * Scale every object with `userData.screenSize` so it covers that many CSS px when seen by
 * `camera` in a viewport `viewportHeightPx` tall.
 */
export function scaleScreenSprites(root: Object3D, camera: Camera, viewportHeightPx: number): void {
  if (viewportHeightPx <= 0) return;
  camera.updateMatrixWorld();
  const camPos = camera.matrixWorld.elements;
  const fx = -camPos[8]!;
  const fy = -camPos[9]!;
  const fz = -camPos[10]!;
  const fl = Math.hypot(fx, fy, fz) || 1;
  root.traverse((obj) => {
    const size = obj.userData.screenSize as ScreenSize | undefined;
    if (!size) return;
    let worldPerPx: number;
    if ((camera as OrthographicCamera).isOrthographicCamera) {
      const o = camera as OrthographicCamera;
      worldPerPx = (o.top - o.bottom) / o.zoom / viewportHeightPx;
    } else {
      const p = camera as PerspectiveCamera;
      const wp = obj.getWorldPosition(obj.position.clone());
      const depth = Math.max(((wp.x - camPos[12]!) * fx + (wp.y - camPos[13]!) * fy + (wp.z - camPos[14]!) * fz) / fl, 0.01);
      worldPerPx = (2 * depth * Math.tan((p.fov * Math.PI) / 360)) / p.zoom / viewportHeightPx;
    }
    obj.scale.set(size.widthPx * worldPerPx, size.heightPx * worldPerPx, 1);
  });
}
