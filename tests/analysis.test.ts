import { describe, expect, it } from 'vitest';
import { syntheticWalk } from '../src/demo/synthetic';
import { prepareClip } from '../src/io/index';
import { analyzeGait, type GaitReport } from '../src/analysis/report';

const metric = (r: GaitReport, id: string) => r.groups.flatMap((g) => g.metrics).find((m) => m.id === id)!;

describe('gait analysis on the synthetic walker (known ground truth)', () => {
  const truth = { strideRate: 55, speed: 1.25, stepWidth: 0.11, toeOut: { left: 8, right: 5 } };
  const report = analyzeGait(prepareClip(syntheticWalk(truth)));

  it('detects every stride on both sides', () => {
    expect(report.warnings).toEqual([]);
    expect(report.overground).toBe(true);
    expect(report.strides.filter((s) => s.side === 'left').length).toBeGreaterThanOrEqual(7);
    expect(report.strides.filter((s) => s.side === 'right').length).toBeGreaterThanOrEqual(7);
  });

  it('recovers cadence, speed and stride length', () => {
    expect(metric(report, 'cadence').both!.mean).toBeCloseTo(truth.strideRate * 2, -0.5);
    expect(metric(report, 'speed').both!.mean).toBeCloseTo(truth.speed, 1);
    expect(metric(report, 'strideLength').both!.mean).toBeCloseTo((truth.speed * 60) / truth.strideRate, 1);
  });

  it('recovers step width and foot progression angle per side', () => {
    expect(metric(report, 'stepWidth').both!.mean).toBeCloseTo(truth.stepWidth, 2);
    const fpa = metric(report, 'fpa');
    expect(Math.abs(fpa.left!.mean - truth.toeOut.left)).toBeLessThan(0.5);
    expect(Math.abs(fpa.right!.mean - truth.toeOut.right)).toBeLessThan(0.5);
  });

  it('puts stance near the configured toe-off fraction', () => {
    const stance = metric(report, 'stancePct');
    expect(stance.left!.mean).toBeGreaterThan(58);
    expect(stance.left!.mean).toBeLessThan(67);
  });

  it('sees the larger right-side eversion the walker was given', () => {
    const ev = metric(report, 'peakEversion');
    expect(ev.status).toBe('ok');
    expect(ev.right!.mean).toBeGreaterThan(ev.left!.mean + 3);
  });

  it('reports near-antiphase coordination', () => {
    expect(Math.abs(metric(report, 'phase').both!.mean - 180)).toBeLessThan(10);
  });

  it('produces cycle-normalised curves of 101 samples', () => {
    const knee = report.curves.find((c) => c.id === 'kneeFlex')!;
    expect(knee.left!.mean).toHaveLength(101);
    expect(Math.max(...knee.left!.mean)).toBeGreaterThan(40); // swing-phase peak
  });

  it('degrades to proxy, not wrong, when rotation markers are missing', () => {
    const clip = syntheticWalk();
    for (const k of ['L_MT1', 'L_MT5', 'R_MT1', 'R_MT5']) clip.trajectories.delete(k);
    const r = analyzeGait(prepareClip(clip));
    expect(metric(r, 'peakEversion').status).toBe('proxy');
    expect(metric(r, 'strideLength').status).toBe('ok');
  });
});
