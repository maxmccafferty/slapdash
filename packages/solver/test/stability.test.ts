/**
 * The Rapier stability sim, in Node (rapier3d-compat bundles its WASM). It reads the
 * same pinned/fixed joint flags as the frame solver.
 */
import { describe, expect, it } from 'vitest';
import { simulateStability } from '../src/stability/index.ts';
import { handProject, INDEX, poolHouse, wallBox } from './helpers.ts';

/** A 4x4 post, 8 ft tall, standing on the ground through one joint at its base. */
function post(jointTypeId: string) {
  return handProject(
    [{ id: 'P1', role: 'post', materialId: 'spf-no2', sectionId: '4x4', position: { x: 88.9, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 }, size: { length: 2438.4, width: 88.9, height: 88.9 } }],
    [{ id: 'J0001', jointTypeId, partIds: ['P1', 'GROUND'], at: { x: 44.45, y: 0, z: 44.45 } }],
  );
}

describe('stability sim', () => {
  it('a post embedded in concrete (fixed) stands', async () => {
    const r = await simulateStability(post('post-embedded'), INDEX);
    expect(r.verdict).toBe('stable');
    expect(r.movedParts).toEqual([]);
  });

  it('the same post on a post base (pinned) tips over on its own', async () => {
    const r = await simulateStability(post('post-base'), INDEX);
    expect(r.verdict).toBe('tips');
    expect(r.movedParts[0]!.id).toBe('P1');
    expect(r.movedParts[0]!.rotation_deg).toBeGreaterThan(30);
    expect(r.message).toMatch(/tips over/);
  });

  it('a box of pinned stud walls with no bracing collapses', async () => {
    const r = await simulateStability(wallBox('none'), INDEX);
    expect(r.verdict).toBe('collapses');
    expect(r.message).toMatch(/sheathing, a brace or a fixed joint/);
  });

  it('the same walls stand with sheathing, and with let-in braces', async () => {
    expect((await simulateStability(wallBox('sheathing'), INDEX)).verdict).toBe('stable');
    expect((await simulateStability(wallBox('let-in'), INDEX)).verdict).toBe('stable');
  });

  it('the pool-house shell stands', async () => {
    const r = await simulateStability(poolHouse(), INDEX);
    expect(r.verdict).toBe('stable');
    for (const m of r.movedParts) expect(m.displacement_mm).toBeLessThan(25);
  });

  it('is deterministic, and records frames for playback when asked', async () => {
    const opts = { duration_s: 0.5, recordEvery: 10 };
    const a = await simulateStability(post('post-base'), INDEX, opts);
    const b = await simulateStability(post('post-base'), INDEX, opts);
    expect(a.frames).toHaveLength(Math.round(0.5 * 60) / 10 + 1);
    expect(b.frames).toEqual(a.frames);
    expect(b.movedParts).toEqual(a.movedParts);
    // The first frame is the starting pose: the box centre, unrotated.
    const [x, y, z, , , , w] = a.frames![0]!.parts.P1!;
    expect([x, y, z, w].map((v) => Math.round(v * 100) / 100)).toEqual([44.45, 1219.2, 44.45, 1]);
  });
});
