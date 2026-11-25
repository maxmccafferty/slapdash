/**
 * Smoke test: runs the core package in plain Node (no DOM, no build step).
 *   node packages/core/scripts/smoke.ts
 */
import {
  CommandBus,
  SAMPLE_CATALOG,
  commandJsonSchemas,
  createProject,
  formatErrors,
  formatFeetInches,
  type ExecResult,
} from '../src/index.ts';

function must(step: string, res: ExecResult | { ok: boolean; errors?: unknown }): void {
  if (!res.ok) {
    const errors = 'errors' in res && Array.isArray(res.errors) ? formatErrors(res.errors) : '';
    console.error(`FAIL: ${step}\n${errors}`);
    process.exit(1);
  }
}

if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  console.error('FAIL: a DOM global is present');
  process.exit(1);
}

const bus = new CommandBus({ project: createProject({ name: 'Smoke shed' }), catalog: SAMPLE_CATALOG });

must('add_assembly', bus.execute('add_assembly', { name: 'South wall', kind: 'wall' }));
const added = bus.execute('add_part', {
  assemblyId: 'W1',
  role: 'stud',
  materialId: 'spf-no2',
  sectionId: '2x4',
  position: { x: 0, y: 0, z: 0 },
  rotation: { z: 90 },
  length: '8ft',
});
must('add_part', added);
const partId = added.ok ? added.created[0]! : '';
must('connect', bus.execute('connect', { jointTypeId: 'post-base', partIds: [partId, 'GROUND'], at: { x: 0, y: 0, z: 0 } }));

const before = bus.project;
must('undo', bus.undo());
if (Object.keys(bus.project.joints).length !== 0) {
  console.error('FAIL: undo did not remove the joint');
  process.exit(1);
}
must('redo', bus.redo());
if (JSON.stringify(bus.project) !== JSON.stringify(before)) {
  console.error('FAIL: redo did not restore the same project');
  process.exit(1);
}
must('save_version', bus.saveVersion('first stud'));

// Builders: a slab and a wall with a window, as one undo step.
const shed = new CommandBus({ project: createProject({ name: 'Smoke builders' }), catalog: SAMPLE_CATALOG });
shed.group({ label: 'Slab and wall', source: 'claude' }, () => {
  must('pour_slab', shed.execute('pour_slab', { from: { x: 0, z: 0 }, to: { x: '12ft', z: '10ft' } }));
  must(
    'build_wall',
    shed.execute('build_wall', {
      start: { x: 0, z: 0 },
      end: { x: '12ft', z: 0 },
      height: '8ft',
      openings: [{ kind: 'window', centerAt: '6ft' }],
    }),
  );
});
const built = Object.values(shed.project.parts);
if (!built.some((p) => p.role === 'header') || !built.some((p) => p.role === 'slab')) {
  console.error('FAIL: builders did not lay out a slab and a framed window');
  process.exit(1);
}
const builtState = shed.project;
must('undo builders', shed.undo());
must('redo builders', shed.redo());
if (JSON.stringify(shed.project) !== JSON.stringify(builtState)) {
  console.error('FAIL: redo did not restore the builders');
  process.exit(1);
}

const part = bus.project.parts[partId]!;
const schemas = commandJsonSchemas();
console.log(`part ${partId}: ${formatFeetInches(part.size.length)} long`);
console.log(`joints: ${Object.keys(bus.project.joints).join(', ')}`);
console.log(`versions: ${bus.listVersions().map((v) => v.name).join(', ')}`);
console.log(`tool schemas: ${schemas.length}`);
console.log(`builders: ${built.length} parts, ${Object.keys(shed.project.joints).length} joints`);
console.log('OK');
