/**
 * The agent's `snapshot` tool in the browser: renders through the offscreen renderer
 * (`renderSnapshot`, so the user's view never moves) and hands the PNG to the agent loop as
 * base64. Pass it as `snapshot` in the loop's deps.
 */
import type { SnapshotImage, SnapshotProvider } from '@slapdash/agent';
import { renderSnapshot } from '../renderer/snapshot/registry.ts';

/** Base64 of a blob's bytes, without a `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export const browserSnapshotProvider: SnapshotProvider = async (request): Promise<SnapshotImage> => {
  const result = await renderSnapshot(request);
  return {
    data: await blobToBase64(result.png),
    width: result.width,
    height: result.height,
    angle: result.angle,
    mode: result.mode,
    notes: result.notes,
  };
};
