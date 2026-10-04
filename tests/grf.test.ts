/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import ASX from './fixtures/07.asx?raw';
import AMC from './fixtures/07_01.amc?raw';
import { parseAsf, parseAmc } from '../src/io/asf';
import { prepareClip } from '../src/io/index';
import { analyzeGait, type GaitReport } from '../src/analysis/report';
import { syntheticWalk } from '../src/demo/synthetic';

const metric = (r: GaitReport, id: string) => r.groups.flatMap((g) => g.metrics).find((m) => m.id === id)!;

/** Mean force over whole strides: steady walking must average 1 BW up, 0 fore-aft. */
function strideMean(r: GaitReport, axis: 0 | 1) {
  const a = Math.min(...r.events.strides.map((s) => s.hs));
  const b = Math.max(...r.events.strides.map((s) => s.next));
  return r.grf!.total.slice(a, b).reduce((s, f) => s + f[axis], 0) / (b - a);
}

describe('estimated ground reaction force: synthetic walker', () => {
  const r = analyzeGait(prepareClip(syntheticWalk()));
  const g = r.grf!;

  it('averages one body weight vertically and ~0 fore-aft over whole strides', () => {
    expect(g.method).toBe('segmental com');
    expect(strideMean(r, 1)).toBeCloseTo(1, 1);
    expect(Math.abs(strideMean(r, 0))).toBeLessThan(0.02);
  });

  it('splits the total exactly between the feet, and a swing foot carries nothing', () => {
    for (let i = 0; i < g.total.length; i++) {
      for (const a of [0, 1, 2]) expect(g.foot.left[i][a] + g.foot.right[i][a]).toBeCloseTo(g.total[i][a], 9);
      for (const side of ['left', 'right'] as const) {
        if (!g.contact[side][i]) {
          expect(g.foot[side][i]).toEqual([0, 0, 0]);
          expect(g.cop[side][i]).toBeNull();
        }
      }
    }
  });

  it('rolls the centre of pressure from heel to toe on the floor', () => {
    const st = r.events.strides.find((s) => s.side === 'left')!;
    const early = g.cop.left[st.hs + 2]!, late = g.cop.left[st.to - 2]!;
    expect(early[1]).toBe(0);
    // Walking +X: the COP moves forward through stance by most of a foot length.
    expect(late[0] - early[0]).toBeGreaterThan(0.1);
  });
});

describe('estimated ground reaction force: real cmu walk 07_01', () => {
  const r = analyzeGait(prepareClip(parseAmc(AMC, parseAsf(ASX, '07.asx'), '07_01.amc')));

  it('averages one body weight over whole strides', () => {
    expect(Math.abs(strideMean(r, 1) - 1)).toBeLessThan(0.03);
  });

  it('shows the double-hump vertical profile with walking-range magnitudes', () => {
    const p1 = metric(r, 'grfPeak1').both!.mean, p2 = metric(r, 'grfPeak2').both!.mean;
    const valley = metric(r, 'grfValley').both!.mean;
    for (const p of [p1, p2]) {
      expect(p).toBeGreaterThan(1.0);
      expect(p).toBeLessThan(1.5);
    }
    expect(valley).toBeLessThan(Math.min(p1, p2) - 0.2);
    for (const id of ['grfBraking', 'grfPropulsion']) {
      expect(metric(r, id).both!.mean).toBeGreaterThan(0.1);
      expect(metric(r, id).both!.mean).toBeLessThan(0.4);
    }
  });

  it('adds vertical, fore-aft and mediolateral cycle curves', () => {
    for (const id of ['grfV', 'grfAP', 'grfML']) {
      const c = r.curves.find((x) => x.id === id)!;
      expect(c.status).toBe('ok');
      expect(c.left!.mean).toHaveLength(101);
    }
  });
});
