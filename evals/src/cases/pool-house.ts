/**
 * Acceptance 2 (LOC-108): "Build a 16×20 pool house on a slab with 9ft walls", then "Build it".
 * Turn 1 must show a plan and change nothing; turn 2 must build a slab and four 9ft walls as
 * one undo step, 16×20 on the plan, with nothing running through anything.
 */
import type { KeyholeClient } from '@slapdash/agent';
import { findAllClashes } from '@slapdash/core';
import { evalSession } from '../harness.ts';

const IN = 25.4;

export interface CaseResult {
  name: string;
  failures: string[];
  /** Dollars per turn. */
  costs: number[];
}

export async function poolHouse(client: KeyholeClient, log: (line: string) => void): Promise<CaseResult> {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
  };
  const s = evalSession(client, { log });

  log('  Turn 1: "Build a 16×20 pool house on a slab with 9ft walls"');
  const t1 = await s.turn('Build a 16×20 pool house on a slab with 9ft walls');
  log(`    Claude: ${t1.text}`);
  check(t1.plan !== null, 'turn 1 should end with a plan (propose_plan)');
  check(s.bus.listHistory().length === 0, 'turn 1 should change nothing');

  log('  Turn 2: "Build it"');
  const t2 = await s.turn({ text: 'Build it', approvePlan: true });
  log(`    Claude: ${t2.text}`);
  const history = s.bus.listHistory();
  check(history.length === 1, `turn 2 should add exactly one undo step (got ${history.length})`);
  check(history[0]?.source === 'claude' && history[0]?.turnId === t2.turnId, "the undo step should be Claude's turn 2");

  const p = s.bus.project;
  const walls = Object.values(p.assemblies).filter((a) => a.kind === 'wall');
  const slabs = Object.values(p.parts).filter((x) => x.role === 'slab');
  check(slabs.length === 1, `one slab (got ${slabs.length})`);
  check(walls.length === 4, `four walls (got ${walls.length})`);

  const studs = Object.values(p.parts).filter((x) => x.role === 'stud' && x.tags.includes('common'));
  check(studs.length > 0 && studs.every((x) => Math.abs(x.size.length - 103.5 * IN) < 1), 'common studs should be 103 1/2in (9ft walls)');

  const slab = slabs[0];
  if (slab) {
    const [short, long] = [slab.size.length, slab.size.width].sort((a, b) => a - b) as [number, number];
    check(
      Math.abs(short - 16 * 12 * IN) <= IN && Math.abs(long - 20 * 12 * IN) <= IN,
      `slab footprint should be 16×20 ±1in (got ${(short / IN).toFixed(1)}in × ${(long / IN).toFixed(1)}in)`,
    );
  }
  const clashes = findAllClashes(p);
  check(clashes.length === 0, `no clashes (got ${clashes.length}: ${clashes.slice(0, 3).map((c) => c.join('×')).join(', ')})`);

  return { name: 'pool-house', failures, costs: [t1.costUsd, t2.costUsd] };
}
