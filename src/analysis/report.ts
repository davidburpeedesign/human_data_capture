/**
 * The gait report: one pass over a clip producing every metric the UI and
 * exports show. Metrics are grouped the way a clinician reads them, carry
 * left / right / pooled statistics, and are honest about their inputs: a
 * metric whose landmarks are missing is `unavailable`, and one computed from
 * a fallback segment axis is `proxy`.
 */
import type { MotionClip, Side, Vec3 } from '../core/types';
import { cv, derivative, ensemble, mean, range, resample, std } from '../core/signal';
import { computeAngles, type SideAngles } from './angles';
import { computeCom } from './com';
import { createContext, type AnalysisOptions } from './context';
import { detectEvents, rightOf, type Events, type Stride } from './events';
import { buildSegments, type Quality } from './segments';
import { strideParams, type StrideParams } from './spatiotemporal';

export interface Stat {
  mean: number;
  sd: number;
  n: number;
}

export type MetricStatus = 'ok' | 'proxy' | 'unavailable';

export interface Metric {
  id: string;
  label: string;
  unit: string;
  left?: Stat;
  right?: Stat;
  /** Pooled across sides, or a whole-body value (cadence, COM). */
  both?: Stat;
  /** Signed symmetry index, %: 100·(R−L)/mean(R,L). 0 = symmetric. */
  symmetry?: number;
  status: MetricStatus;
  note?: string;
}

export interface MetricGroup {
  id: string;
  label: string;
  metrics: Metric[];
}

export interface Curve {
  id: string;
  label: string;
  unit: string;
  left?: { mean: number[]; sd: number[] };
  right?: { mean: number[]; sd: number[] };
  status: MetricStatus;
}

export interface GaitReport {
  clipId: string;
  overground: boolean;
  events: Events;
  strides: StrideParams[];
  groups: MetricGroup[];
  curves: Curve[];
  com: { path: Vec3[]; method: string } | null;
  angles: Record<Side, SideAngles>;
  warnings: string[];
}

const SIDES: Side[] = ['left', 'right'];

const stat = (x: number[]): Stat | undefined => {
  const v = x.filter(Number.isFinite);
  return v.length ? { mean: mean(v), sd: v.length > 1 ? std(v) : 0, n: v.length } : undefined;
};

const symmetry = (l?: Stat, r?: Stat) =>
  l && r && Math.abs(l.mean + r.mean) > 1e-9 ? (100 * (r.mean - l.mean)) / ((l.mean + r.mean) / 2) : undefined;

// A ratio index is meaningless for signed quantities that cross zero
// (angles, angular velocity); those show the raw l/r values only.
const RATIO_UNITS = new Set(['m', 's', 'ms', '% cycle', 'm/s']);

const status = (q: Quality | undefined): MetricStatus => (q === undefined ? 'unavailable' : q === 'proxy' ? 'proxy' : 'ok');

/** Build a metric from a per-stride extractor. */
function sided(
  id: string,
  label: string,
  unit: string,
  per: Record<Side, number[]>,
  q: MetricStatus,
  note?: string,
): Metric {
  const left = stat(per.left), right = stat(per.right);
  const both = stat([...per.left, ...per.right]);
  return {
    id, label, unit, left, right, both,
    symmetry: RATIO_UNITS.has(unit) ? symmetry(left, right) : undefined,
    status: both ? q : 'unavailable',
    note,
  };
}

// Heuristic bands for the pronation readout. Not diagnostic; tune per lab.
export const EVERSION_HIGH = 10; // deg peak eversion → pronated pattern
export const EVERSION_LOW = 2;   // deg → supinated / rigid pattern

export function analyzeGait(clip: MotionClip, opts: Partial<AnalysisOptions> = {}): GaitReport {
  const ctx = createContext(clip, { treadmillSpeed: clip.treadmillSpeed, ...opts });
  const warnings: string[] = [];
  const dt = 1 / ctx.rate;

  const segs = buildSegments(ctx);
  const events = detectEvents(ctx);
  const angles = computeAngles(segs, events.heading);

  if (!events.pelvis) warnings.push('no pelvis landmarks: gait events cannot be detected');
  if (events.strides.length === 0) warnings.push('no complete strides detected');

  for (const side of SIDES) {
    for (const seg of [segs.thigh[side], segs.shank[side], segs.foot[side]]) {
      if (seg?.note) warnings.push(`${side}: ${seg.note}`);
    }
  }

  // Overground if the pelvis actually travelled; a treadmill keeps it put.
  const pel = events.pelvis;
  // Net displacement misses a walker who loops back to the start, so also
  // accept a sustained (smoothed) pelvis speed.
  const travel = pel ? Math.hypot(pel[pel.length - 1][0] - pel[0][0], pel[pel.length - 1][2] - pel[0][2]) : 0;
  const overground = travel > 1 || mean(events.speed) > 0.3;

  const sp = strideParams(ctx, events, overground);
  const strides = (side: Side) => events.strides.filter((s) => s.side === side);
  const spOf = (side: Side) => sp.filter((s) => s.side === side);
  const pick = (k: keyof StrideParams, f = 1) =>
    ({ left: spOf('left').map((s) => (s[k] as number) * f), right: spOf('right').map((s) => (s[k] as number) * f) });

  /** Apply an extractor to an angle series over each stride of each side. */
  const perStride = (angleId: string, fn: (v: number[], st: Stride) => number) => {
    const out: Record<Side, number[]> = { left: [], right: [] };
    for (const side of SIDES) {
      const a = angles[side][angleId];
      if (!a) continue;
      for (const st of strides(side)) out[side].push(fn(a.values, st));
    }
    return out;
  };
  const q = (angleId: string): MetricStatus => {
    const qs = SIDES.map((s) => angles[s][angleId]?.quality).filter(Boolean) as Quality[];
    return qs.length ? status(qs.includes('proxy') ? 'proxy' : 'full') : 'unavailable';
  };
  const stance = (v: number[], st: Stride) => v.slice(st.hs, st.to + 1);
  const cycle = (v: number[], st: Stride) => v.slice(st.hs, st.next + 1);

  // ── spatiotemporal ───────────────────────────────────────────────────
  const strideTimes = sp.map((s) => s.strideTime);
  const strideLens = sp.map((s) => s.strideLength).filter(Number.isFinite);
  const speed = ctx.opts.treadmillSpeed ?? (strideLens.length ? mean(strideLens) / mean(strideTimes) : NaN);
  const allHs = [...events.heelStrikes.left, ...events.heelStrikes.right].sort((a, b) => a - b);
  const stepTimes = allHs.slice(1).map((h, i) => (h - allHs[i]) * dt);

  const spatio: MetricGroup = {
    id: 'spatiotemporal',
    label: 'spatiotemporal',
    metrics: [
      { id: 'speed', label: 'walking speed', unit: 'm/s', both: stat([speed]), status: Number.isFinite(speed) ? 'ok' : 'unavailable' },
      { id: 'cadence', label: 'cadence', unit: 'steps/min', both: stat(stepTimes.map((t) => 60 / t)), status: stepTimes.length ? 'ok' : 'unavailable' },
      sided('strideLength', 'stride length', 'm', pick('strideLength'), 'ok', overground ? undefined : 'treadmill: sum of consecutive steps'),
      sided('stepLength', 'step length', 'm', pick('stepLength'), 'ok'),
      sided('stepWidth', 'step width', 'm', pick('stepWidth'), 'ok'),
      sided('strideTime', 'stride time', 's', pick('strideTime'), 'ok'),
      sided('stanceTime', 'contact duration', 's', pick('stanceTime'), 'ok'),
      sided('swingTime', 'swing time', 's', pick('swingTime'), 'ok'),
      sided('stancePct', 'stance', '% cycle', pick('stancePct'), 'ok'),
    ],
  };

  // ── loading / unloading ──────────────────────────────────────────────
  const loading: MetricGroup = {
    id: 'loading',
    label: 'loading / unloading',
    metrics: [
      sided('loading', 'loading response', 'ms', pick('loadingTime', 1000), 'ok', 'heel strike → contralateral toe off'),
      sided('footFlat', 'time to foot flat', 'ms', pick('footFlatTime', 1000), 'ok'),
      sided('heelOff', 'time to heel off', 'ms', pick('heelOffTime', 1000), 'ok'),
      sided('unloading', 'unloading (pre-swing)', 'ms', pick('unloadingTime', 1000), 'ok', 'contralateral heel strike → toe off'),
    ],
  };

  // ── foot & ankle ─────────────────────────────────────────────────────
  // FPA is averaged over mid-stance, when the foot is flat and its heading stable.
  const midStance = (v: number[], st: Stride) => {
    const a = Number.isFinite(st.footFlat) ? st.footFlat : st.hs + Math.round(0.2 * (st.to - st.hs));
    const b = Number.isFinite(st.heelOff) && st.heelOff > a ? st.heelOff : st.hs + Math.round(0.8 * (st.to - st.hs));
    return b > a ? mean(v.slice(a, b + 1)) : mean(v.slice(st.hs, st.to + 1));
  };
  const footAnkle: MetricGroup = {
    id: 'footAnkle',
    label: 'foot & ankle',
    metrics: [
      sided('fpa', 'foot progression angle', 'deg', perStride('fpa', midStance), q('fpa'), 'toe-out +'),
      sided('ankleExcursion', 'ankle excursion (stance)', 'deg', perStride('ankleDorsi', (v, st) => range(stance(v, st))), q('ankleDorsi')),
      sided('ankleExcursionCycle', 'ankle excursion (cycle)', 'deg', perStride('ankleDorsi', (v, st) => range(cycle(v, st))), q('ankleDorsi')),
      sided('peakDorsi', 'peak dorsiflexion (stance)', 'deg', perStride('ankleDorsi', (v, st) => Math.max(...stance(v, st))), q('ankleDorsi')),
      sided('peakPlantar', 'peak plantarflexion', 'deg', perStride('ankleDorsi', (v, st) => -Math.min(...cycle(v, st))), q('ankleDorsi')),
    ],
  };

  // ── pronation / supination ───────────────────────────────────────────
  const invVel: Record<Side, number[]> = {
    left: angles.left.ankleInv ? derivative(angles.left.ankleInv.values, ctx.rate) : [],
    right: angles.right.ankleInv ? derivative(angles.right.ankleInv.values, ctx.rate) : [],
  };
  const peakEv = perStride('ankleInv', (v, st) => -Math.min(...stance(v, st)));
  const pattern = (s?: Stat) =>
    !s ? '' : s.mean > EVERSION_HIGH ? 'pronated' : s.mean < EVERSION_LOW ? 'supinated' : 'neutral';
  const evL = stat(peakEv.left), evR = stat(peakEv.right);
  const pronation: MetricGroup = {
    id: 'pronation',
    label: 'pronation / supination',
    metrics: [
      sided('peakEversion', 'peak eversion (stance)', 'deg', peakEv, q('ankleInv'),
        `pattern l: ${pattern(evL) || '–'} · r: ${pattern(evR) || '–'} (heuristic)`),
      sided('eversionExcursion', 'eversion excursion', 'deg',
        perStride('ankleInv', (v, st) => v[st.hs] - Math.min(...stance(v, st))), q('ankleInv'), 'heel strike → peak eversion'),
      sided('timeToPeakEversion', 'time to peak eversion', '% stance',
        perStride('ankleInv', (v, st) => {
          const s = stance(v, st);
          return (100 * s.indexOf(Math.min(...s))) / (s.length - 1);
        }), q('ankleInv')),
      sided('eversionVelocity', 'peak eversion velocity', 'deg/s',
        { left: strides('left').map((st) => -Math.min(...invVel.left.slice(st.hs, st.to + 1))),
          right: strides('right').map((st) => -Math.min(...invVel.right.slice(st.hs, st.to + 1))) },
        q('ankleInv')),
    ],
  };

  // ── tibial & knee rotation ───────────────────────────────────────────
  const rotation: MetricGroup = {
    id: 'rotation',
    label: 'tibial & knee rotation',
    metrics: [
      sided('tibiaRotRom', 'tibial rotation rom (stance)', 'deg', perStride('tibiaRot', (v, st) => range(stance(v, st))), q('tibiaRot')),
      sided('tibiaRotMean', 'tibial rotation mean (stance)', 'deg', perStride('tibiaRot', (v, st) => mean(stance(v, st))), q('tibiaRot'), 'internal +'),
      sided('kneeRotRom', 'knee rotation rom (stance)', 'deg', perStride('kneeRot', (v, st) => range(stance(v, st))), q('kneeRot')),
      sided('kneeRotPeak', 'peak internal knee rotation', 'deg', perStride('kneeRot', (v, st) => Math.max(...stance(v, st))), q('kneeRot')),
      sided('kneeFlexLoading', 'knee flexion (loading peak)', 'deg',
        perStride('kneeFlex', (v, st) => Math.max(...v.slice(st.hs, st.hs + Math.round(0.5 * (st.to - st.hs)) + 1))), q('kneeFlex')),
    ],
  };

  // ── centre of mass ───────────────────────────────────────────────────
  const com = computeCom(ctx, segs, events.pelvis);
  // Per-stride excursion. Mediolateral is measured across the stride's own
  // heading so that walking a bend doesn't read as sway.
  const comPer = (axis: 'vertical' | 'lateral') => {
    const out: number[] = [];
    if (!com) return out;
    for (const st of strides('right').length ? strides('right') : strides('left')) {
      const right = rightOf(events.heading[Math.round((st.hs + st.next) / 2)]);
      const seg = com.path.slice(st.hs, st.next + 1);
      out.push(range(seg.map((p) => (axis === 'vertical' ? p[1] : p[0] * right[0] + p[2] * right[2]))));
    }
    return out;
  };
  const comStatus: MetricStatus = !com ? 'unavailable' : com.method === 'segmental' ? 'ok' : 'proxy';
  const comGroup: MetricGroup = {
    id: 'com',
    label: 'centre of mass',
    metrics: [
      { id: 'comVertical', label: 'vertical excursion', unit: 'cm', both: stat(comPer('vertical').map((v) => v * 100)), status: comStatus, note: com?.method },
      { id: 'comLateral', label: 'mediolateral excursion', unit: 'cm', both: stat(comPer('lateral').map((v) => v * 100)), status: comStatus, note: com?.method },
    ],
  };

  // ── variability ──────────────────────────────────────────────────────
  const cvSided = (id: string, label: string, k: keyof StrideParams): Metric => {
    const l = pick(k).left.filter(Number.isFinite), r = pick(k).right.filter(Number.isFinite);
    const toStat = (x: number[]) => (x.length > 2 ? { mean: cv(x), sd: 0, n: x.length } : undefined);
    const left = toStat(l), right = toStat(r), both = toStat([...l, ...r]);
    return { id, label, unit: 'cv %', left, right, both, status: both ? 'ok' : 'unavailable', note: both ? undefined : 'needs ≥ 3 strides' };
  };
  const variability: MetricGroup = {
    id: 'variability',
    label: 'gait variability',
    metrics: [
      cvSided('cvStrideTime', 'stride time', 'strideTime'),
      cvSided('cvStrideLength', 'stride length', 'strideLength'),
      cvSided('cvStance', 'contact duration', 'stanceTime'),
      cvSided('cvSwing', 'swing time', 'swingTime'),
      cvSided('cvStepWidth', 'step width', 'stepWidth'),
    ],
  };

  // ── left / right coordination ────────────────────────────────────────
  // Phase coordination index (Plotnik et al. 2007): where in each left
  // stride the right heel strikes, ideally exactly half way (180°).
  const phases: number[] = [];
  for (const st of strides('left')) {
    const r = events.heelStrikes.right.find((h) => h > st.hs && h < st.next);
    if (r !== undefined) phases.push((360 * (r - st.hs)) / (st.next - st.hs));
  }
  const phiAbs = phases.length ? mean(phases.map((p) => Math.abs(p - 180))) : NaN;
  const pci = phases.length > 2 ? cv(phases) + (100 * phiAbs) / 180 : NaN;
  const symOf = (m: Metric) => m.symmetry;
  const coordination: MetricGroup = {
    id: 'coordination',
    label: 'left / right coordination',
    metrics: [
      { id: 'phase', label: 'inter-limb phase', unit: 'deg', both: stat(phases), status: phases.length ? 'ok' : 'unavailable', note: 'ideal 180' },
      { id: 'pci', label: 'phase coordination index', unit: '%', both: stat([pci]), status: Number.isFinite(pci) ? 'ok' : 'unavailable', note: 'lower is better' },
      ...(['stepLength', 'strideTime', 'stanceTime', 'swingTime'] as const).map((id): Metric => {
        const src = spatio.metrics.find((m) => m.id === id)!;
        const si = symOf(src);
        return {
          id: `si_${id}`,
          label: `symmetry: ${src.label}`,
          unit: '% (r−l)',
          both: si === undefined ? undefined : { mean: si, sd: 0, n: 1 },
          status: si === undefined ? 'unavailable' : 'ok',
        };
      }),
    ],
  };

  // ── cycle-normalised curves ──────────────────────────────────────────
  const curve = (id: string, label: string, unit: string, series: Record<Side, number[] | undefined>, st: MetricStatus): Curve => {
    const c: Curve = { id, label, unit, status: st };
    for (const side of SIDES) {
      const v = series[side];
      if (!v) continue;
      const cycles = strides(side).map((s) => resample(v, s.hs, s.next));
      if (cycles.length) c[side] = ensemble(cycles);
    }
    if (!c.left && !c.right) c.status = 'unavailable';
    return c;
  };
  const series = (id: string) => ({ left: angles.left[id]?.values, right: angles.right[id]?.values });
  const curves: Curve[] = [
    curve('hipFlex', 'hip flexion', 'deg', series('hipFlex'), q('hipFlex')),
    curve('kneeFlex', 'knee flexion', 'deg', series('kneeFlex'), q('kneeFlex')),
    curve('ankleDorsi', 'ankle dorsiflexion', 'deg', series('ankleDorsi'), q('ankleDorsi')),
    curve('ankleInv', 'inversion (+) / eversion (−)', 'deg', series('ankleInv'), q('ankleInv')),
    curve('tibiaRot', 'tibial rotation', 'deg', series('tibiaRot'), q('tibiaRot')),
    curve('kneeRot', 'knee rotation', 'deg', series('kneeRot'), q('kneeRot')),
    curve('fpa', 'foot progression', 'deg', series('fpa'), q('fpa')),
    curve('comY', 'com height', 'cm',
      { left: com?.path.map((p) => p[1] * 100), right: com?.path.map((p) => p[1] * 100) }, comStatus),
  ];

  return {
    clipId: clip.id,
    overground,
    events,
    strides: sp,
    groups: [spatio, loading, footAnkle, pronation, rotation, comGroup, variability, coordination],
    curves,
    com,
    angles,
    warnings,
  };
}
