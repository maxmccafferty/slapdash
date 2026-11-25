/**
 * The solver client against a fake Worker that routes to the real `handleSolverMessage`
 * (in this thread), with control over when replies are delivered.
 */
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject, type Project } from '@slapdash/core';
import { createSolverState, handleSolverMessage, type SolverRequest, type SolverResponse } from '@slapdash/solver/protocol';
import { describe, expect, it } from 'vitest';
import { createSolverClient, StaleSolverRequest, type SolverWorkerLike } from '../../src/analysis/solver-client.ts';

class FakeWorker implements SolverWorkerLike {
  onmessage: ((event: MessageEvent<SolverResponse>) => void) | null = null;
  sent: SolverRequest[] = [];
  replies: SolverResponse[] = [];
  terminated = false;
  private state = createSolverState();
  private work: Promise<unknown> = Promise.resolve();

  postMessage(message: SolverRequest) {
    this.sent.push(message);
    this.work = this.work.then(async () => this.replies.push(await handleSolverMessage(this.state, message)));
  }
  /** Deliver the replies so far, in the given order (default: as they came). */
  async flush(order?: (replies: SolverResponse[]) => SolverResponse[]) {
    await this.work;
    const out = order ? order(this.replies) : this.replies;
    this.replies = [];
    for (const r of out) this.onmessage?.({ data: r } as MessageEvent<SolverResponse>);
    await Promise.resolve();
  }
  terminate() {
    this.terminated = true;
  }
}

function shed(width: string): Project {
  const bus = new CommandBus({ project: createProject({ name: 'Shed' }), catalog: TIER1_CATALOG });
  const res = bus.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: width, z: '8ft' } });
  if (!res.ok) throw new Error('pour_slab failed');
  const wall = bus.execute('build_wall', { start: { x: 0, z: 0 }, end: { x: width, z: 0 }, height: '8ft' });
  if (!wall.ok) throw new Error('build_wall failed');
  return bus.project;
}

describe('solver client', () => {
  it('sends init with the catalog first, then answers analyze', async () => {
    const w = new FakeWorker();
    const client = createSolverClient(TIER1_CATALOG, () => w);
    const p = client.analyze(shed('8ft'));
    expect(w.sent.map((m) => m.type)).toEqual(['init', 'analyze']);
    await w.flush();
    const r = await p;
    expect(r.status).toBe('ok');
    expect(Object.keys(r.parts).length).toBeGreaterThan(5);
  });

  it('the newest request wins: the older promise rejects as stale and its late reply is dropped', async () => {
    const w = new FakeWorker();
    const client = createSolverClient(TIER1_CATALOG, () => w);
    const first = client.analyze(shed('8ft'));
    const firstOutcome = first.then(
      () => 'resolved',
      (e: unknown) => e,
    );
    const second = client.analyze(shed('12ft'));
    expect(await firstOutcome).toBeInstanceOf(StaleSolverRequest);
    // Deliver the newer reply before the older one: the older must not overwrite anything.
    await w.flush((rs) => [...rs].reverse());
    const r = await second;
    // The 12ft wall has more studs than the 8ft one, so the part lists tell them apart.
    expect(Object.keys(r.parts).sort()).toEqual(Object.keys(shed('12ft').parts).sort());
    expect(Object.keys(r.parts).length).not.toBe(Object.keys(shed('8ft').parts).length);
  });

  it('analyze and stability are tracked separately', async () => {
    const w = new FakeWorker();
    const client = createSolverClient(TIER1_CATALOG, () => w);
    const a = client.analyze(shed('8ft'));
    const s = client.stability(shed('8ft'), { duration_s: 0.2 });
    await w.flush();
    expect((await a).status).toBe('ok');
    expect(['stable', 'tips', 'collapses']).toContain((await s).verdict);
  });

  it('a solver error rejects the promise; dispose rejects what is pending and ends the worker', async () => {
    const w = new FakeWorker();
    const client = createSolverClient(TIER1_CATALOG, () => w);
    const bad = client.analyze({ nope: true } as unknown as Project);
    await w.flush();
    await expect(bad).rejects.toThrow();
    const pending = client.analyze(shed('8ft'));
    client.dispose();
    await expect(pending).rejects.toBeInstanceOf(StaleSolverRequest);
    expect(w.terminated).toBe(true);
  });
});
