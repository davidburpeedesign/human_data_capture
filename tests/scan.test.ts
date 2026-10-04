import { describe, expect, it } from 'vitest';
import { syntheticScan } from '../src/demo/syntheticScan';
import { analyzeScan } from '../src/analysis/scan';

describe('scan analysis', () => {
  const r = analyzeScan(syntheticScan(1.75));
  const g = (id: string) => r.girths.find((x) => x.id === id)!.value;

  it('measures stature', () => {
    expect(r.height).toBeCloseTo(1.75, 2);
  });

  it('separates limbs from the torso and orders girths plausibly', () => {
    expect(g('waist')).toBeLessThan(g('chest'));
    expect(g('waist')).toBeLessThan(g('hip'));
    expect(g('thigh')).toBeGreaterThan(g('calf'));
    expect(g('calf')).toBeGreaterThan(g('ankle'));
    // Two separate leg loops at mid-thigh.
    const thighSlice = r.profile.find((s) => Math.abs(s.height - 0.44 * r.height) < 0.011)!;
    expect(thighSlice.loops.length).toBeGreaterThanOrEqual(2);
  });
});
