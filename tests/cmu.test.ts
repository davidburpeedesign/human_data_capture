/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { parseAmc, parseAsf } from '../src/io/asf';
import { importFiles, prepareClip, registerSkeleton, skeletonFor } from '../src/io/index';
import ASX from './fixtures/07.asx?raw'; // real CMU subject 07 skeleton
import AMC_07_01 from './fixtures/07_01.amc?raw'; // real CMU walk, subject 07 trial 01
import { resolveLandmarks } from '../src/core/landmarks';
import { analyzeGait, type GaitReport } from '../src/analysis/report';
import { lowpass } from '../src/core/signal';
import { syntheticWalk } from '../src/demo/synthetic';
import type { MotionClip, Trajectory } from '../src/core/types';

/**
 * A CMU-style skeleton: same bone names, hierarchy, units line and axis
 * conventions as the database's `NN.asf` files (Y up, +X subject-left,
 * +Z forward), with round numbers.
 */
const bone = (id: number, name: string, dir: string, length: number, dof = '', axis = '0 0 0') => `
  begin
     id ${id}
     name ${name}
     direction ${dir}
     length ${length}
     axis ${axis} XYZ${dof ? `\n     dof ${dof}` : ''}
  end`;

const ASF = `# AST/ASF file generated using VICON BodyLanguage
:version 1.10
:name VICON
:units
  mass 1.0
  length 0.45
  angle deg
:documentation
   .ast/.asf automatically generated from VICON data
:root
   order TX TY TZ RX RY RZ
   axis XYZ
   position 0 0 0
   orientation 0 0 0
:bonedata${[
  bone(1, 'lhipjoint', '0.707 -0.707 0', 2.4),
  bone(2, 'lfemur', '0 -1 0', 7.2, 'rx ry rz', '0 0 20'),
  bone(3, 'ltibia', '0 -1 0', 7.4, 'rx', '0 0 20'),
  bone(4, 'lfoot', '0 -0.3 0.954', 2.3, 'rx rz'),
  bone(5, 'ltoes', '0 0 1', 1.0, 'rx'),
  bone(6, 'rhipjoint', '-0.707 -0.707 0', 2.4),
  bone(7, 'rfemur', '0 -1 0', 7.2, 'rx ry rz', '0 0 -20'),
  bone(8, 'rtibia', '0 -1 0', 7.4, 'rx', '0 0 -20'),
  bone(9, 'rfoot', '0 -0.3 0.954', 2.3, 'rx rz'),
  bone(10, 'rtoes', '0 0 1', 1.0, 'rx'),
  bone(11, 'lowerback', '0 1 0', 2.0, 'rx ry rz'),
  bone(12, 'upperback', '0 1 0', 2.0, 'rx ry rz'),
  bone(13, 'thorax', '0 1 0', 2.0, 'rx ry rz'),
  bone(14, 'lowerneck', '0 1 0', 1.5, 'rx ry rz'),
  bone(15, 'upperneck', '0 1 0', 1.5, 'rx ry rz'),
  bone(16, 'head', '0 1 0', 1.5, 'rx ry rz'),
  bone(17, 'lclavicle', '1 0.2 0', 3.0, 'ry rz'),
  bone(18, 'lhumerus', '1 0 0', 5.0, 'rx ry rz'),
  bone(19, 'lradius', '1 0 0', 3.4, 'rx'),
  bone(20, 'lwrist', '1 0 0', 1.2, 'ry'),
  bone(21, 'rclavicle', '-1 0.2 0', 3.0, 'ry rz'),
  bone(22, 'rhumerus', '-1 0 0', 5.0, 'rx ry rz'),
  bone(23, 'rradius', '-1 0 0', 3.4, 'rx'),
  bone(24, 'rwrist', '-1 0 0', 1.2, 'ry'),
].join('')}
:hierarchy
  begin
    root lhipjoint rhipjoint lowerback
    lhipjoint lfemur
    lfemur ltibia
    ltibia lfoot
    lfoot ltoes
    rhipjoint rfemur
    rfemur rtibia
    rtibia rfoot
    rfoot rtoes
    lowerback upperback
    upperback thorax
    thorax lowerneck lclavicle rclavicle
    lowerneck upperneck
    upperneck head
    lclavicle lhumerus
    lhumerus lradius
    lradius lwrist
    rclavicle rhumerus
    rhumerus rradius
    rradius rwrist
  end
`;

const IN = 0.0254 / 0.45; // metres per CMU length unit

function amc(frames: Record<string, number[]>[]) {
  return [':FULLY-SPECIFIED', ':DEGREES', ...frames.flatMap((f, i) => [
    String(i + 1),
    ...Object.entries(f).map(([k, v]) => `${k} ${v.join(' ')}`),
  ])].join('\n');
}

const at = (c: MotionClip, name: string, f = 0) => {
  const d = c.trajectories.get(name)!.data;
  return [d[f * 3], d[f * 3 + 1], d[f * 3 + 2]];
};

describe('asf/amc (cmu)', () => {
  const skel = parseAsf(ASF, '02.asf');

  it('reads bones, hierarchy and the length unit', () => {
    expect(skel.bones).toHaveLength(24);
    expect(skel.unit).toBeCloseTo(IN, 6);
    expect(skel.bones.find((b) => b.name === 'lfemur')!.length).toBeCloseTo(7.2 * IN, 6);
  });

  it('runs FK: rest pose, root translation and a joint rotation', () => {
    const clip = parseAmc(amc([
      { root: [0, 30, 0, 0, 0, 0] },
      { root: [0, 30, 10, 0, 0, 0] },
      { root: [0, 30, 0, 0, 0, 0], lfemur: [90, 0, 0] },
    ]), skel, '02_01.amc');

    // Rest: knee straight below the hip by one femur length.
    const hip = at(clip, 'lfemur');
    const knee = at(clip, 'ltibia');
    expect(knee[0]).toBeCloseTo(hip[0], 5);
    expect(hip[1] - knee[1]).toBeCloseTo(7.2 * IN, 5);
    // Root translation is in file units too.
    expect(at(clip, 'root', 1)[2]).toBeCloseTo(10 * IN, 5);
    // rx = 90° about the femur's local x swings the knee to -Z, whatever the
    // bone's axis tilt (C · M · C⁻¹ cancels at the hip).
    const k2 = at(clip, 'ltibia', 2);
    const h2 = at(clip, 'lfemur', 2);
    const v = [k2[0] - h2[0], k2[1] - h2[1], k2[2] - h2[2]];
    expect(Math.hypot(...v)).toBeCloseTo(7.2 * IN, 5);
    expect(v[1]).toBeGreaterThan(-0.05); // no longer hanging down
  });

  it('pairs trials with their subject skeleton', () => {
    registerSkeleton(ASF, '02.asf');
    expect(skeletonFor('02_01.amc')?.name).toBe('02.asf');
    expect(skeletonFor('subjects/02/02_05.amc')?.name).toBe('02.asf');
  });

  it('emits canonical markers that resolve, in metres, on the floor', () => {
    const clip = prepareClip(parseAmc(amc([{ root: [0, 30, 0, 0, 0, 0] }]), skel, '02_01.amc'));
    for (const id of [
      'L_HJC', 'R_HJC', 'L_KNEE_LAT', 'L_KNEE_MED', 'R_ANKLE_LAT', 'R_ANKLE_MED',
      'L_HEEL', 'L_TOE', 'L_MT1', 'R_MT5', 'L_ASIS', 'R_PSIS', 'SACRUM', 'C7', 'HEAD',
      'L_SHOULDER', 'L_ELBOW', 'L_WRIST',
    ] as const) {
      expect(clip.landmarks[id], id).toBeTruthy();
    }
    // Leg = 7.2 + 7.4 units plus foot drop ≈ 0.86 m; hips ~0.85–0.95 m up.
    const hjc = clip.trajectories.get(clip.landmarks.L_HJC!)!.data;
    expect(hjc[1]).toBeGreaterThan(0.8);
    expect(hjc[1]).toBeLessThan(1.0);
    // Shoulder marker comes from the humerus start, elbow from the radius.
    expect(clip.landmarks.L_SHOULDER).toBe('L_SHOULDER');
  });

  it('analyses a walking amc trial end to end', () => {
    // 0.9 Hz strides: legs swing in antiphase while the root moves forward.
    const rate = 120, n = 6 * rate, f = 0.9;
    const frames = Array.from({ length: n }, (_, i) => {
      const t = i / rate, ph = 2 * Math.PI * f * t;
      const leg = (p: number) => ({ hip: -25 * Math.sin(p), knee: 30 * Math.max(0, Math.sin(p - 1.2)) });
      const l = leg(ph), r = leg(ph + Math.PI);
      return {
        root: [0, 31 - 0.4 * Math.cos(2 * ph), (1.25 * t) / IN, 0, 0, 0],
        lfemur: [l.hip, 0, 0], ltibia: [l.knee],
        rfemur: [r.hip, 0, 0], rtibia: [r.knee],
      };
    });
    const report = analyzeGait(prepareClip(parseAmc(amc(frames), skel, '02_99.amc', rate)));
    const cadence = report.groups[0].metrics.find((m) => m.id === 'cadence')!.both!.mean;
    expect(report.overground).toBe(true);
    expect(report.events.strides.filter((s) => s.side === 'left').length).toBeGreaterThanOrEqual(3);
    expect(cadence).toBeCloseTo(2 * f * 60, -1);
  });
});

describe('real cmu skeleton (subject 07, .asx)', () => {
  it('parses all 30 bones with anatomically plausible lengths', () => {
    const skel = parseAsf(ASX, '07.asx');
    expect(skel.bones).toHaveLength(30);
    const len = (n: string) => skel.bones.find((b) => b.name === n)!.length;
    expect(len('lfemur')).toBeCloseTo(0.391, 2);
    expect(len('ltibia')).toBeCloseTo(0.418, 2);
    expect(len('lhumerus')).toBeCloseTo(0.28, 2);
  });

  it('pairs with an .amc trial from a single drop and resolves every landmark', async () => {
    const trial = amc([{ root: [0, 17, 0, 0, 0, 0] }, { root: [0, 17, 1, 0, 0, 0] }]);
    const { datasets, skeletons, errors } = await importFiles([
      new File([trial], '07_01.amc'),
      new File([ASX], '07.asx'), // order must not matter
    ]);
    expect(errors).toEqual([]);
    expect(skeletons).toEqual(['07.asx']);
    const clip = datasets[0] as MotionClip;
    expect(Object.keys(clip.landmarks)).toHaveLength(31);
    // Hip joint ~0.79 m and head base ~1.43 m above the floor: a ~1.6 m subject.
    const y = (id: 'L_HJC' | 'HEAD') => clip.trajectories.get(clip.landmarks[id]!)!.data[1];
    expect(y('L_HJC')).toBeGreaterThan(0.7);
    expect(y('L_HJC')).toBeLessThan(0.9);
    expect(y('HEAD')).toBeGreaterThan(1.3);
    expect(y('HEAD')).toBeLessThan(1.6);
  });
});

describe('real cmu walk (07_01.amc on 07.asx)', () => {
  const clip = prepareClip(parseAmc(AMC_07_01, parseAsf(ASX, '07.asx'), '07_01.amc'));
  const report = analyzeGait(clip);
  const m = (id: string) => report.groups.flatMap((g) => g.metrics).find((x) => x.id === id)!;

  it('finds strides on both sides of a 2.6 s walk', () => {
    expect(clip.frameCount).toBe(316);
    expect(report.overground).toBe(true);
    expect(report.events.strides.filter((s) => s.side === 'left').length).toBeGreaterThanOrEqual(1);
    expect(report.events.strides.filter((s) => s.side === 'right').length).toBeGreaterThanOrEqual(1);
  });

  it('gives normal-walking spatiotemporal values that agree with each other', () => {
    const cadence = m('cadence').both!.mean, stride = m('strideLength').both!.mean, step = m('stepLength').both!.mean;
    expect(cadence).toBeGreaterThan(100);
    expect(cadence).toBeLessThan(120);
    expect(stride).toBeGreaterThan(1.3);
    expect(stride).toBeLessThan(1.7);
    // Regression guard: early heel-strike detection once gave 0.37 m steps.
    expect(step / stride).toBeGreaterThan(0.4);
    expect(step / stride).toBeLessThan(0.55);
    expect(m('stancePct').both!.mean).toBeGreaterThan(52);
    expect(m('stancePct').both!.mean).toBeLessThan(66);
  });

  it('reproduces the knee angle stored in the trial', () => {
    const tibia: number[] = [];
    for (const line of AMC_07_01.split(/\r?\n/)) if (line.startsWith('ltibia ')) tibia.push(+line.split(/\s+/)[1]);
    const knee = report.angles.left.kneeFlex.values;
    // Markers are low-passed at 6 Hz before angles are computed; filter the
    // reference the same way, and skip the filter's edge frames.
    const ref = lowpass(tibia, clip.rate, 6);
    for (let i = 10; i < tibia.length - 10; i++) expect(Math.abs(knee[i] - ref[i])).toBeLessThan(2);
  });

  it('has no rest-pose inversion offset from the splayed CMU legs', () => {
    expect(Math.abs(m('peakEversion').both!.mean)).toBeLessThan(6);
  });

  it('levels the slightly tilted floor before measuring COM bob', () => {
    expect(Math.abs(+clip.meta.floor_tilt_deg)).toBeGreaterThan(0.5);
    expect(Math.abs(+clip.meta.floor_tilt_deg)).toBeLessThan(2);
    expect(m('comVertical').both!.mean).toBeGreaterThan(2);
    expect(m('comVertical').both!.mean).toBeLessThan(5);
  });

  it('reports knee axial rotation as unavailable for a hinge-knee rig', () => {
    expect(clip.meta.knee_axial).toBe('locked');
    expect(m('kneeRotRom').status).toBe('unavailable');
    expect(m('tibiaRotRom').status).toBe('ok');
  });
});

describe('cmu c3d marker set', () => {
  it('resolves the 41-marker labels, subject prefix and all', () => {
    const labels = [
      'LFHD', 'RFHD', 'LBHD', 'RBHD', 'C7', 'T10', 'CLAV', 'STRN', 'RBAC',
      'LSHO', 'LUPA', 'LELB', 'LFRM', 'LWRA', 'LWRB', 'LFIN',
      'RSHO', 'RUPA', 'RELB', 'RFRM', 'RWRA', 'RWRB', 'RFIN',
      'LFWT', 'RFWT', 'LBWT', 'RBWT',
      'LTHI', 'LKNE', 'LSHN', 'LANK', 'LHEE', 'LTOE', 'LMT5',
      'RTHI', 'RKNE', 'RSHN', 'RANK', 'RHEE', 'RTOE', 'RMT5',
    ].map((l) => `Subject02:${l}`);
    const trajectories = new Map<string, Trajectory>(labels.map((l) => [l, { name: l, data: new Float32Array(3) }]));
    const clip = resolveLandmarks({
      kind: 'motion', id: 'x', name: 'x.c3d', format: 'c3d', rate: 120, frameCount: 1,
      trajectories, bones: [], landmarks: {}, meta: {},
    });
    expect(clip.landmarks).toMatchObject({
      L_ASIS: 'Subject02:LFWT', R_ASIS: 'Subject02:RFWT',
      L_PSIS: 'Subject02:LBWT', R_PSIS: 'Subject02:RBWT',
      L_KNEE_LAT: 'Subject02:LKNE', L_ANKLE_LAT: 'Subject02:LANK',
      L_HEEL: 'Subject02:LHEE', L_TOE: 'Subject02:LTOE', L_MT5: 'Subject02:LMT5',
      R_SHOULDER: 'Subject02:RSHO', R_ELBOW: 'Subject02:RELB', R_WRIST: 'Subject02:RWRA',
      C7: 'Subject02:C7',
    });
    expect(clip.landmarks.HEAD).toMatch(/:[LR]FHD$/); // either front-head marker
    // No medial markers in this set: those stay unresolved (metrics → proxy).
    expect(clip.landmarks.L_KNEE_MED).toBeUndefined();
  });
});

describe('curved walking path', () => {
  /** Bend the straight synthetic walk onto a circle of radius R, turning left. */
  function bend(clip: MotionClip, R: number): MotionClip {
    const trajectories = new Map<string, Trajectory>();
    for (const [k, t] of clip.trajectories) {
      const d = new Float32Array(t.data.length);
      for (let i = 0; i < d.length; i += 3) {
        const x = t.data[i], y = t.data[i + 1], z = t.data[i + 2];
        const th = x / R;
        d[i] = (R + z) * Math.sin(th);
        d[i + 1] = y;
        d[i + 2] = -R + (R + z) * Math.cos(th);
      }
      trajectories.set(k, { ...t, data: d });
    }
    return { ...clip, trajectories };
  }

  const metric = (r: GaitReport, id: string) => r.groups.flatMap((g) => g.metrics).find((m) => m.id === id)!;
  const truth = { strideRate: 55, speed: 1.25, stepWidth: 0.11, toeOut: { left: 8, right: 5 } };
  // 12.5 m on a 6 m radius: about a 120° turn.
  const report = analyzeGait(prepareClip(bend(syntheticWalk(truth), 6)));

  it('still finds every stride', () => {
    expect(report.strides.filter((s) => s.side === 'left').length).toBeGreaterThanOrEqual(7);
    expect(report.strides.filter((s) => s.side === 'right').length).toBeGreaterThanOrEqual(7);
  });

  it('keeps foot progression, step width and stride length relative to the path', () => {
    const fpa = metric(report, 'fpa');
    expect(Math.abs(fpa.left!.mean - truth.toeOut.left)).toBeLessThan(1.5);
    expect(Math.abs(fpa.right!.mean - truth.toeOut.right)).toBeLessThan(1.5);
    expect(Math.abs(metric(report, 'stepWidth').both!.mean - truth.stepWidth)).toBeLessThan(0.015);
    const stride = (truth.speed * 60) / truth.strideRate;
    expect(Math.abs(metric(report, 'strideLength').both!.mean - stride) / stride).toBeLessThan(0.04);
  });

  it('does not mistake the bend for lateral sway', () => {
    expect(metric(report, 'comLateral').both!.mean).toBeLessThan(5);
  });
});
