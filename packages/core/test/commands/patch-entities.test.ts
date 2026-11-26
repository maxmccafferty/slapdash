import { describe, expect, it } from 'vitest';
import { expectRoundTrip, fixtureProject, runOk, model, applyInverse } from '../helpers.ts';

describe('patch_entities', () => {
  it('put and remove in one patch round-trips', () => {
    const p = fixtureProject();
    const moved = { ...p.parts['W1-S02']!, position: { x: 1000, y: 38.1, z: 0 } };
    const added = { ...p.parts['W1-S02']!, id: 'W1-S09' };
    const res = expectRoundTrip(p, 'patch_entities', {
      put: { parts: [moved, added] },
      remove: { parts: ['W1-S01'], joints: ['J0001'] },
    });
    expect(res.project.parts['W1-S01']).toBeUndefined();
    expect(res.project.joints.J0001).toBeUndefined();
    expect(res.project.parts['W1-S02']!.position.x).toBe(1000);
    expect(res.project.parts['W1-S09']).toBeDefined();
  });

  it('removing a part that had joints restores both on undo', () => {
    const p = fixtureProject();
    const res = runOk(p, 'patch_entities', { remove: { parts: ['W1-S01'], joints: ['J0001'] } });
    expect(model(applyInverse(res.project, res.inverse))).toEqual(model(p));
  });

  it('merges counters forward and never back', () => {
    const p = fixtureProject();
    const res = runOk(p, 'patch_entities', { counters: { assemblies: { W: 7 }, parts: {}, joints: 1 } });
    expect(res.project.counters.assemblies.W).toBe(7);
    expect(res.project.counters.joints).toBe(p.counters.joints);
  });
});
