import { describe, expect, it } from 'vitest';
import { RAMP, diverging, rampCss, sideMagnitude } from '../src/core/colormap';

const hex = (c: number[]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

describe('magnitude colour ramp', () => {
  it('hits every stop exactly, black at zero', () => {
    RAMP.forEach((stop, i) => expect(hex(diverging(-1 + (2 * i) / (RAMP.length - 1)))).toBe(stop));
    expect(hex(diverging(0))).toBe('#201c1d');
  });

  it('clamps outside [-1, 1]', () => {
    expect(hex(diverging(5))).toBe('#f3dada');
    expect(hex(diverging(-5))).toBe('#b2e3d9');
  });

  it('runs each side from black toward its own limb hue', () => {
    expect(hex(sideMagnitude('left', 0))).toBe('#201c1d');
    expect(hex(sideMagnitude('left', 0.75))).toBe('#ea5964'); // ≈ --data-left
    expect(hex(sideMagnitude('right', 0.75))).toBe('#4697c5'); // ≈ --data-right
  });

  it('builds a CSS gradient with all nine stops', () => {
    const css = rampCss();
    for (const stop of RAMP) expect(css).toContain(stop);
  });
});
