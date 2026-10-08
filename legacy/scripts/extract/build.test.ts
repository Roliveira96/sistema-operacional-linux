import { describe, expect, it } from 'vitest';
import { stableStringify } from './build';
import { seededRandom } from './execute';

describe('reproducibility helpers', () => {
  // Covers SPEC-005 CA-02 at the unit level; the full run is checked by comparing artifact hashes.
  it('serializes with sorted keys and without undefined members', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('produces the same random sequence for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(1)()).not.toBe(seededRandom(2)());
  });
});
