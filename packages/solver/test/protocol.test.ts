import { describe, expect, it } from 'vitest';
import { createSolverState, handleSolverMessage, type SolverRequest } from '../src/protocol.ts';
import { CATALOG, handProject } from './helpers.ts';

const post = () =>
  handProject(
    [{ id: 'P1', role: 'post', materialId: 'spf-no2', sectionId: '4x4', position: { x: 88.9, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 }, size: { length: 2438.4, width: 88.9, height: 88.9 } }],
    [{ id: 'J0001', jointTypeId: 'post-embedded', partIds: ['P1', 'GROUND'], at: { x: 44.45, y: 0, z: 44.45 } }],
  );

describe('solver protocol', () => {
  it('init → analyze → stability', async () => {
    const state = createSolverState();
    const init = await handleSolverMessage(state, { type: 'init', id: 1, catalog: CATALOG });
    expect(init).toEqual({ id: 1, type: 'init', ok: true, result: { ready: true } });

    const a = await handleSolverMessage(state, { type: 'analyze', id: 2, project: post() });
    expect(a).toMatchObject({ id: 2, type: 'analyze', ok: true, result: { status: 'ok', parts: { P1: { role: 'member' } } } });

    const s = await handleSolverMessage(state, { type: 'stability', id: 3, project: post(), options: { duration_s: 0.5 } });
    expect(s).toMatchObject({ id: 3, type: 'stability', ok: true, result: { verdict: 'stable' } });
  });

  it('returns errors as { ok: false } rather than throwing', async () => {
    const state = createSolverState();
    const early = await handleSolverMessage(state, { type: 'analyze', id: 7, project: post() });
    expect(early).toMatchObject({ id: 7, type: 'analyze', ok: false });
    expect(early.ok ? '' : early.error).toMatch(/send init first/);

    await handleSolverMessage(state, { type: 'init', id: 8, catalog: CATALOG });
    const bad = await handleSolverMessage(state, { type: 'analyze', id: 9, project: { nope: true } as never });
    expect(bad).toMatchObject({ id: 9, ok: false });
  });

  it('answers an unknown message type with an error', async () => {
    const r = await handleSolverMessage(createSolverState(), { type: 'explode', id: 4 } as unknown as SolverRequest);
    expect(r).toMatchObject({ id: 4, type: 'unknown', ok: false });
  });
});
