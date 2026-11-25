/**
 * Photos the person sends when Claude asks for one (ADR-0003 §J.4). They are downscaled to
 * the size Claude reads at, kept in memory and handed to `AgentMemory` through `loadFile`.
 * Until project storage is wired in they don't outlive the page.
 */
import type { LoadedFile } from '@slapdash/agent';
import { blobToBase64 } from './snapshot-provider.ts';

/** Claude's preferred long edge; bigger images are scaled down server-side anyway. */
export const PHOTO_MAX_EDGE = 1568;
export const PHOTO_QUALITY = 0.85;

export interface PreparedPhoto {
  blob: Blob;
  mimeType: string;
}

export interface StoredPhoto {
  fileId: string;
  mimeType: string;
  /** Object URL for thumbnails. */
  url: string;
}

export interface PhotoStore {
  put(photo: PreparedPhoto): Promise<StoredPhoto>;
  remove(fileId: string): void;
  loadFile(fileId: string): Promise<LoadedFile | null>;
  revokeAll(): void;
}

let photoCounter = 0;

export function createPhotoStore(opts: { createUrl?: (blob: Blob) => string; revokeUrl?: (url: string) => void } = {}): PhotoStore {
  const createUrl = opts.createUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl = opts.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const files = new Map<string, { data: string; mimeType: string; url: string }>();
  return {
    async put(photo) {
      const fileId = `photo-${Date.now().toString(36)}-${++photoCounter}`;
      const data = await blobToBase64(photo.blob);
      const url = createUrl(photo.blob);
      files.set(fileId, { data, mimeType: photo.mimeType, url });
      return { fileId, mimeType: photo.mimeType, url };
    },
    remove(fileId) {
      const f = files.get(fileId);
      if (!f) return;
      revokeUrl(f.url);
      files.delete(fileId);
    },
    async loadFile(fileId) {
      const f = files.get(fileId);
      return f ? { data: f.data, mediaType: f.mimeType } : null;
    },
    revokeAll() {
      for (const f of files.values()) revokeUrl(f.url);
      files.clear();
    },
  };
}

/** Downscale to ≤ 1568px on the long edge and re-encode as JPEG. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This browser can't read the photo.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error("This browser can't read the photo.");
    return { blob, mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}
