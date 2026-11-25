import { describe, expect, it } from 'vitest';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS, isTap, partLabel } from '../../src/renderer/picking.ts';
import { sampleProject } from './fixtures.ts';

describe('isTap: tap selects, drag orbits', () => {
  const tap = { downAt: 0, upAt: 100, moved_px: 0, maxPointers: 1 };
  it('a short, still, single touch is a tap', () => {
    expect(isTap(tap)).toBe(true);
    expect(isTap({ ...tap, moved_px: TAP_MAX_MOVE_PX })).toBe(true);
    expect(isTap({ ...tap, upAt: TAP_MAX_MS })).toBe(true);
  });
  it('moving more than 6 px is a drag', () => {
    expect(isTap({ ...tap, moved_px: 6.5 })).toBe(false);
  });
  it('holding longer than 500 ms is not a tap', () => {
    expect(isTap({ ...tap, upAt: 501 })).toBe(false);
  });
  it('two fingers (pinch or pan) never select', () => {
    expect(isTap({ ...tap, maxPointers: 2 })).toBe(false);
  });
});

describe('partLabel', () => {
  const project = sampleProject();
  it('is the role and the assembly name', () => {
    expect(partLabel(project, 'W3-H01')).toBe('Header, South wall');
    expect(partLabel(project, 'W1-S01')).toBe('Stud, North wall');
  });
  it('prefers the part name when it has one', () => {
    const named = { ...project, parts: { ...project.parts, 'W1-S01': { ...project.parts['W1-S01']!, name: 'King stud' } } };
    expect(partLabel(named, 'W1-S01')).toBe('King stud, North wall');
  });
  it('is null for an unknown part', () => {
    expect(partLabel(project, 'W9-S99')).toBeNull();
  });
});
