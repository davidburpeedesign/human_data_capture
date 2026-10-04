/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import ASX from './fixtures/07.asx?raw';
import RUN from './fixtures/09_01.amc?raw'; // real CMU run, subject 09 trial 01
import WALK from './fixtures/07_01.amc?raw';
import ASX09 from './fixtures/09.asx?raw';
import RUN3 from './fixtures/09_03.amc?raw'; // CMU run 09_03, with its own skeleton
import { parseAsf, parseAmc } from '../src/io/asf';
import { prepareClip } from '../src/io/index';
import { analyzeGait, type GaitReport } from '../src/analysis/report';
import { ensemble } from '../src/core/signal';

// 09_01 runs on subject 07's skeleton (09.asx arrived later; 09_03 below
// uses it). Bone lengths shift distances a little, but timing, event
// detection and which strides exist (what these tests are about) come from
// the motion.
const skel = parseAsf(ASX, '07.asx');
const run = analyzeGait(prepareClip(parseAmc(RUN, skel, '09_01.amc')));
const metric = (r: GaitReport, id: string) => r.groups.flatMap((g) => g.metrics).find((m) => m.id === id)!;

describe('short running trial (1.2 s, one complete stride on one side only)', () => {
  it('is recognised as running, and walking stays walking', () => {
    expect(run.mode).toBe('running');
    expect(analyzeGait(prepareClip(parseAmc(WALK, skel, '07_01.amc'))).mode).toBe('walking');
  });

  it('keeps the left stance that the trial cut off as a partial stride', () => {
    const left = run.events.strides.filter((s) => s.side === 'left');
    const right = run.events.strides.filter((s) => s.side === 'right');
    expect(right.some((s) => !s.partial)).toBe(true);
    expect(left).toHaveLength(1);
    expect(left[0].partial).toBe(true);
  });

  it('reports left stance metrics instead of leaving the side empty', () => {
    for (const id of ['stanceTime', 'grfPeak1', 'peakEversion', 'ankleExcursion']) {
      expect(metric(run, id).left, id).toBeDefined();
      expect(metric(run, id).right, id).toBeDefined();
    }
    // Stride-level values need the next heel strike: none for the partial side.
    expect(metric(run, 'strideTime').left).toBeUndefined();
    expect(metric(run, 'strideTime').right).toBeDefined();
  });

  it('gives running-range values', () => {
    const speed = metric(run, 'speed').both!.mean;
    expect(speed).toBeGreaterThan(2.5);
    expect(speed).toBeLessThan(5);
    expect(metric(run, 'stancePct').right!.mean).toBeLessThan(45); // flight phase
    expect(metric(run, 'stanceTime').left!.mean).toBeLessThan(0.35);
    expect(metric(run, 'grfPeak1').both!.mean).toBeGreaterThan(1.8); // ~2–3 BW when running
    expect(metric(run, 'loading').note).toMatch(/running/);
  });

  it('fills the left cycle from both ends of the trial', () => {
    // The left foot is already down at frame 0 (toe-off before its first
    // heel strike) and lands again near the end: together the two cut-off
    // stances cover the whole cycle.
    expect(run.events.leading.map((s) => s.side)).toContain('left');
    for (const id of ['kneeFlex', 'grfV']) {
      const c = run.curves.find((x) => x.id === id)!;
      const covered = (m: number[]) => m.filter(Number.isFinite).length;
      expect(covered(c.right!.mean), id).toBe(101);
      expect(covered(c.left!.mean), id).toBe(101);
    }
  });
});

describe('ensemble with partial curves', () => {
  it('averages the curves that cover each point', () => {
    const e = ensemble([[1, 2, 3], [3, NaN, NaN]]);
    expect(e.mean).toEqual([2, 2, 3]);
    expect(e.sd[1]).toBe(0);
    expect(Number.isNaN(ensemble([[NaN], [NaN]]).mean[0])).toBe(true);
  });
});

describe('foot progression in running swing', () => {
  it('leaves frames where the foot points backward out instead of wrapping ±180°', () => {
    const fpa = run.curves.find((c) => c.id === 'fpa')!;
    for (const side of ['left', 'right'] as const) {
      const finite = fpa[side]!.mean.filter(Number.isFinite);
      expect(finite.length, side).toBeGreaterThan(20);
      expect(Math.max(...finite.map(Math.abs)), side).toBeLessThan(60);
    }
    // Stance, where the metric is taken, is untouched.
    expect(Number.isFinite(metric(run, 'fpa').right!.mean)).toBe(true);
  });
});

describe('run 09_03 with its own skeleton (1.07 s, left foot down at the start)', () => {
  const r = analyzeGait(prepareClip(parseAmc(RUN3, parseAsf(ASX09, '09.asx'), '09_03.amc')));

  it('registers both feet', () => {
    expect(r.mode).toBe('running');
    expect(r.events.heelStrikes.left.length).toBeGreaterThan(0);
    expect(r.events.heelStrikes.right.length).toBeGreaterThan(0);
    // The opening left stance: real toe-off, heel strike before the clip.
    const lead = r.events.leading.find((s) => s.side === 'left')!;
    expect(lead.hs).toBeLessThan(0);
    expect(lead.to).toBeGreaterThan(0);
    expect(lead.next).toBe(r.events.heelStrikes.left[0]);
  });

  it('draws the left curves over most of the cycle, not just the last stance', () => {
    for (const id of ['hipFlex', 'kneeFlex', 'grfV']) {
      const c = r.curves.find((x) => x.id === id)!;
      const covered = (m: number[]) => m.filter(Number.isFinite).length;
      expect(covered(c.right!.mean), id).toBe(101);
      expect(covered(c.left!.mean), id).toBeGreaterThan(95);
    }
  });

  it('keeps stance metrics to stances it saw land', () => {
    for (const id of ['stanceTime', 'grfPeak1']) expect(metric(r, id).left, id).toBeDefined();
  });
});
