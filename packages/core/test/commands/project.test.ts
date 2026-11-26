import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/index.ts';
import { expectRoundTrip, makeBus, runErr, runOk } from '../helpers.ts';

describe('rename_project', () => {
  it('renames the project and the inverse restores the old name', () => {
    const res = expectRoundTrip(createProject({ name: 'New project' }), 'rename_project', { name: 'Pool house' });
    expect(res.project.name).toBe('Pool house');
    expect(res.summary).toBe('Renamed the project to "Pool house".');
    expect(res.inverse).toEqual([{ name: 'rename_project', input: { name: 'New project' } }]);
    expect(res.redo).toEqual({ name: 'rename_project', input: { name: 'Pool house' } });
    expect(res.created).toEqual([]);
  });

  it('trims whitespace', () => {
    const res = runOk(createProject({ name: 'a' }), 'rename_project', { name: '  Pool house  ' });
    expect(res.project.name).toBe('Pool house');
  });

  it('renaming to the same name is a no-op', () => {
    const p = createProject({ name: 'Shed' });
    const res = runOk(p, 'rename_project', { name: 'Shed' });
    expect(res.project).toBe(p);
    expect(res.inverse).toEqual([]);
    expect(res.summary).toBe('The project is already called "Shed".');
  });

  it('is undoable through the bus', () => {
    const bus = makeBus(createProject({ name: 'New project' }));
    expect(bus.execute('rename_project', { name: 'Pool house' }).ok).toBe(true);
    expect(bus.project.name).toBe('Pool house');
    bus.undo();
    expect(bus.project.name).toBe('New project');
  });

  it('schema errors', () => {
    const p = createProject({ name: 't' });
    expect(runErr(p, 'rename_project', { name: '   ' })[0]!.message).toBe(`"name" can't be blank.`);
    expect(runErr(p, 'rename_project', {})[0]!.message).toBe('"name" is required.');
    expect(runErr(p, 'rename_project', { name: 'x'.repeat(121) })[0]!.path).toBe('name');
  });
});
