/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import ASX from './fixtures/07.asx?raw';
import RUN from './fixtures/09_01.amc?raw'; // real CMU run, subject 09 trial 01
import WALK from './fixtures/07_01.amc?raw';
import { parseAsf, parseAmc } from '../src/io/asf';
import { prepareClip } from '../src/io/index';
import { analyzeGait, type GaitReport } from '../src/analysis/report';
import { ensemble } from '../src/core/signal';

// Subject 09's own skeleton isn't in the fixtures; subject 07's stands in.
// Bone lengths shift distances a little, but timing, event detection and
// which strides exist (what these tests are about) come from the motion.
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

  it('draws left curves as far as the trial goes, right curves in full', () => {
    for (const id of ['kneeFlex', 'grfV']) {
      const c = run.curves.find((x) => x.id === id)!;
      const covered = (m: number[]) => m.filter(Number.isFinite).length;
      expect(covered(c.right!.mean)).toBe(101);
      expect(covered(c.left!.mean)).toBeGreaterThan(50);
      expect(covered(c.left!.mean)).toBeLessThan(101);
      expect(Number.isFinite(c.left!.mean[0])).toBe(true); // starts at heel strike
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
