import { describe, expect, it } from 'vitest';
import { blobToBase64 } from '../../src/agent/snapshot-provider.ts';

describe('snapshot provider', () => {
  it('turns the PNG blob into base64 for the agent', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const b64 = await blobToBase64(new Blob([bytes], { type: 'image/png' }));
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
  });
});
