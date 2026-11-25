import { describe, expect, it } from 'vitest';
import { speechText } from '../../src/voice/speech-text.ts';

describe('speechText', () => {
  it.each([
    ['A 6′ 10″ door', 'A 6 feet 10 door'],
    [`A 6' 10" door`, 'A 6 feet 10 door'],
    ['Walls are 9′ 0″ tall', 'Walls are 9 feet tall'],
    ['16′ 0″', '16 feet'],
    ['A 4′ overhang', 'A 4 feet overhang'],
    ['1′ deep', '1 foot deep'],
    ['Trim 3 1/2″ off', 'Trim 3 and a half inches off'],
    ['Raise it 6″', 'Raise it 6 inches'],
    ['1″ gap', '1 inch gap'],
    ['A 16×20 pool house', 'A 16 by 20 pool house'],
    ['2x4 studs', '2 by 4 studs'],
  ])('%s → %s', (input, out) => {
    expect(speechText(input)).toBe(out);
  });

  it('strips markdown markers', () => {
    expect(speechText('# Plan\n\n- **Slab** first\n- Then `walls`\n1. Roof')).toBe('Plan Slab first Then walls Roof');
  });

  it('leaves plain text alone', () => {
    expect(speechText("I'll add a door. It's on the south wall.")).toBe("I'll add a door. It's on the south wall.");
  });
});
