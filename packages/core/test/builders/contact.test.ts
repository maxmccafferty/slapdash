import { describe, expect, it } from 'vitest';
import { contactJoints, type Member } from '../../src/builders/contact.ts';
import { WORLD_FRAME } from '../../src/geometry/frame.ts';

const stud: Member = { ref: '#s', role: 'stud', box: { u0: 0, u1: 38.1, v0: 38.1, v1: 2400, w0: 0, w1: 88.9 } };
const plate: Member = { ref: '#p', role: 'plate', box: { u0: 0, u1: 3000, v0: 0, v1: 38.1, w0: 0, w1: 88.9 } };

describe('contactJoints', () => {
  it('joins members that touch face to face', () => {
    expect(contactJoints(WORLD_FRAME, [stud, plate])).toHaveLength(1);
  });

  it('skips a pair where either member is cut (its box is not its shape)', () => {
    expect(contactJoints(WORLD_FRAME, [{ ...stud, cut: true }, plate])).toEqual([]);
    expect(contactJoints(WORLD_FRAME, [stud], [{ ...plate, cut: true }])).toEqual([]);
  });
});
