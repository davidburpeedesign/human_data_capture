/**
 * A synthetic walker: prescribed foot paths + two-link leg IK, emitting a
 * full canonical marker set.
 *
 * Two jobs. It gives the app something to show before anyone has a file,
 * and it is ground truth for the tests: cadence, stride length, step width,
 * stance fraction and toe-out are inputs here, so the analysis is checked
 * against known answers rather than eyeballed.
 *
 * Feet are driven, legs follow. Each stance rolls over three rockers:
 * heel (heel point pinned, foot lowers), ankle (foot flat), forefoot (toe
 * pinned, heel rises). Swing is a smooth arc to the next footprint. Pelvis
 * height is whatever the stance leg can reach, so the vertical COM bob
 * emerges from the compass mechanics instead of being painted on.
 */
import type { Bone, Mat3, MotionClip, Side, Trajectory, Vec3 } from '../core/types';
import { RAD, add, apply, cross, dot, len, mul, norm, rotX, rotY, rotZ, scale, sub, fromAxes } from '../core/vec';
import { resolveLandmarks } from '../core/landmarks';

export interface WalkerParams {
  rate: number;
  seconds: number;
  /** Strides per minute per leg; cadence (steps/min) is twice this. */
  strideRate: number;
  speed: number;                      // m/s, overground
  stepWidth: number;                  // m, heel-to-heel
  toeOut: Record<Side, number>;       // deg, foot progression angle
  peakEversion: Record<Side, number>; // deg, foot roll in loading response
  /** Toe-off as a fraction of the cycle (stance fraction). */
  toeOff: Record<Side, number>;
  /** Cycle-to-cycle timing jitter, sd as a fraction of stride time. */
  jitter: number;
  /** Right-leg phase offset from the ideal half cycle, fraction. */
  phaseOffset: number;
  noise: number;                      // marker noise sd, m
  seed: number;
}

export const DEFAULT_WALKER: WalkerParams = {
  rate: 120,
  seconds: 10,
  strideRate: 55,
  speed: 1.25,
  stepWidth: 0.11,
  toeOut: { left: 8, right: 5 },
  peakEversion: { left: 5, right: 12 },
  toeOff: { left: 0.61, right: 0.63 },
  jitter: 0.02,
  phaseOffset: 0.015,
  noise: 0.0005,
  seed: 7,
};

const smooth = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

/** Periodic Gaussian bump at cycle fraction c, width w. */
const g = (p: number, c: number, w: number) => {
  let d = Math.abs(p - c) % 1;
  d = Math.min(d, 1 - d);
  return Math.exp(-(d * d) / (2 * w * w));
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Body dimensions, metres.
const THIGH = 0.45, SHANK = 0.44, ANKLE_H = 0.075;
const HEEL_PT: Vec3 = [-0.05, -ANKLE_H, 0];  // heel contact point, foot frame
const TOE_PT: Vec3 = [0.16, -ANKLE_H, 0];    // forefoot rocker point
const FOOT_FLAT = 0.08, HEEL_STRIKE_PITCH = 16, TOE_OFF_PITCH = 55;

export function syntheticWalk(params: Partial<WalkerParams> = {}): MotionClip {
  const P = { ...DEFAULT_WALKER, ...params };
  const n = Math.round(P.rate * P.seconds);
  const rand = rng(P.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const baseT = 60 / P.strideRate;

  // Cumulative phase with per-stride period jitter, sampled densely so
  // phase → time can be inverted for footprint placement.
  const phase = new Float64Array(n);
  let acc = -0.3, period = baseT;
  for (let i = 0; i < n; i++) {
    const before = Math.floor(acc);
    acc += 1 / (P.rate * period);
    if (Math.floor(acc) !== before) period = baseT * (1 + P.jitter * gauss());
    phase[i] = acc;
  }
  const timeAt = (ph: number) => {
    if (ph <= phase[0]) return (ph - phase[0]) * baseT;
    if (ph >= phase[n - 1]) return (n - 1) / P.rate + (ph - phase[n - 1]) * baseT;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (phase[m] < ph) lo = m; else hi = m;
    }
    return (lo + (ph - phase[lo]) / (phase[hi] - phase[lo])) / P.rate;
  };

  const sideOf = (side: Side) => (side === 'right' ? 1 : -1);
  const offsetOf = (side: Side) => (side === 'left' ? 0 : 0.5 + P.phaseOffset);

  /** Foot rotation in the lab: heading (toe-out), pitch (toes up +), roll (inversion +). */
  const footRot = (side: Side, pitch: number, inv: number): Mat3 => {
    const s = sideOf(side);
    return mul(rotY(-s * P.toeOut[side] * RAD), mul(rotZ(pitch * RAD), rotX(s * inv * RAD)));
  };
  const inversion = (side: Side, p: number) =>
    3 * g(p, 0, 0.04) - (P.peakEversion[side] + 2) * g(p, 0.15, 0.07) + 4 * g(p, P.toeOff[side] - 0.04, 0.05);

  /** Heel contact point of footprint k (the k-th heel strike of this side). */
  const footprint = (side: Side, k: number): Vec3 => {
    const ph = k + offsetOf(side);
    // Place the print so the ankle passes under the pelvis at ~30 % stance.
    const x = P.speed * timeAt(ph + 0.3 * P.toeOff[side]) - 0.05;
    return [x, 0, sideOf(side) * P.stepWidth / 2];
  };

  /** Ankle position + foot rotation at side-phase `sp` (integer part = stride). */
  const footPose = (side: Side, sp: number): { ankle: Vec3; R: Mat3 } => {
    const k = Math.floor(sp);
    const p = sp - k;
    const to = P.toeOff[side];
    const heelOffP = to - 0.24;
    const inv = inversion(side, p);

    const stance = (pp: number, kk: number) => {
      const H = footprint(side, kk);
      if (pp < heelOffP) {
        const pitch = HEEL_STRIKE_PITCH * (1 - smooth(pp / FOOT_FLAT));
        const R = footRot(side, pitch, inversion(side, pp));
        return { ankle: sub(H, apply(R, HEEL_PT)), R };
      }
      const flat = footRot(side, 0, 0);
      const T = add(H, apply(flat, sub(TOE_PT, HEEL_PT)));
      const pitch = -TOE_OFF_PITCH * smooth((pp - heelOffP) / (to - heelOffP)) ** 1.5;
      const R = footRot(side, pitch, inversion(side, pp));
      return { ankle: sub(T, apply(R, TOE_PT)), R };
    };

    if (p <= to) return stance(p, k);

    // Swing: blend from this toe-off pose to the next heel-strike pose.
    const u = (p - to) / (1 - to);
    const a = stance(to, k);
    const b = stance(0, k + 1);
    const e = smooth(u);
    const ankle = add(add(scale(a.ankle, 1 - e), scale(b.ankle, e)), [0, 0.07 * Math.sin(Math.PI * u) ** 1.5, 0]);
    const pitch = -TOE_OFF_PITCH + (TOE_OFF_PITCH + HEEL_STRIKE_PITCH) * smooth(u * 1.15);
    return { ankle, R: footRot(side, pitch, inv) };
  };

  const names: string[] = [];
  const traj = new Map<string, Float32Array>();
  const put = (name: string, i: number, v: Vec3) => {
    let d = traj.get(name);
    if (!d) { d = new Float32Array(n * 3); traj.set(name, d); names.push(name); }
    d[i * 3] = v[0] + P.noise * gauss();
    d[i * 3 + 1] = v[1] + P.noise * gauss();
    d[i * 3 + 2] = v[2] + P.noise * gauss();
  };

  for (let i = 0; i < n; i++) {
    const t = i / P.rate;
    const ph = phase[i];
    const feet = {
      left: footPose('left', ph - offsetOf('left')),
      right: footPose('right', ph - offsetOf('right')),
    };

    // Pelvis: steady forward travel, sway toward the stance limb, height
    // capped by what the loaded leg(s) can reach. A swing leg just flexes,
    // except right before contact, when it has to be long enough to land.
    const sway = 0.02 * Math.sin(2 * Math.PI * (ph - 0.12));
    const pelvisRot: Mat3 = mul(rotY(-4 * RAD * Math.sin(2 * Math.PI * ph)), rotX(-2.5 * RAD * Math.sin(2 * Math.PI * ph)));
    const hipOffset = (side: Side): Vec3 => [0, 0, sideOf(side) * 0.09];
    let height = THIGH + SHANK + ANKLE_H - 0.01;
    for (const side of ['left', 'right'] as const) {
      const sp = (((ph - offsetOf(side)) % 1) + 1) % 1;
      if (sp > P.toeOff[side] && sp < 0.9) continue;
      // A leg rolling over its forefoot can flex; it only binds at full reach.
      const loaded = sp >= 0.9 || sp < P.toeOff[side] - 0.24;
      const reach = (loaded ? 0.985 : 0.999) * (THIGH + SHANK);
      const hipXZ = add([P.speed * t, 0, sway], apply(pelvisRot, hipOffset(side)));
      const a = feet[side].ankle;
      const horiz = Math.hypot(hipXZ[0] - a[0], hipXZ[2] - a[2]);
      height = Math.min(height, a[1] + Math.sqrt(Math.max(0, reach * reach - horiz * horiz)));
    }
    const pelvisPos: Vec3 = [P.speed * t, height, sway];
    const R = (v: Vec3) => add(pelvisPos, apply(pelvisRot, v));

    put('L_ASIS', i, R([0.07, 0.09, -0.12]));
    put('R_ASIS', i, R([0.07, 0.09, 0.12]));
    put('L_PSIS', i, R([-0.1, 0.11, -0.045]));
    put('R_PSIS', i, R([-0.1, 0.11, 0.045]));
    put('C7', i, R([-0.06, 0.55, 0]));
    put('HEAD', i, R([0, 0.72, 0]));

    for (const side of ['left', 'right'] as const) {
      const s = sideOf(side);
      const L = side === 'left' ? 'L' : 'R';
      const p = (((ph - offsetOf(side)) % 1) + 1) % 1;
      const { ankle, R: footR } = feet[side];
      const hip = R(hipOffset(side));

      // Knee points along the foot heading, modulated by tibial rotation
      // that tracks foot eversion (subtalar coupling).
      const tibRot = 0.6 * P.peakEversion[side] * g(p, 0.15, 0.08) - 4 * g(p, 0.6, 0.08);
      const legHeading = rotY((-s * P.toeOut[side] + s * 0.5 * tibRot) * RAD);
      const fwd = apply(legHeading, [1, 0, 0]);

      // Two-link IK in the plane of hip, ankle and the knee-forward direction.
      const d0 = sub(ankle, hip);
      const d = Math.min(len(d0), THIGH + SHANK - 1e-4);
      const u = norm(d0);
      const along = (THIGH * THIGH - SHANK * SHANK + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
      const w = norm(sub(fwd, scale(u, dot(fwd, u))));
      const knee = add(add(hip, scale(u, along)), scale(w, h));
      const ankleReached = add(knee, scale(norm(sub(ankle, knee)), SHANK));

      const segFrame = (top: Vec3, bottom: Vec3, forward: Vec3): Mat3 => {
        const Y = norm(sub(top, bottom));
        const X = norm(sub(forward, scale(Y, dot(forward, Y))));
        return fromAxes(X, Y, cross(X, Y));
      };
      const thighR = segFrame(hip, knee, fwd);
      const shankFwd = apply(rotY(-s * 0.5 * tibRot * RAD), fwd);
      const shankR = segFrame(knee, ankleReached, shankFwd);

      put(`${L}_HJC`, i, hip);
      put(`${L}_KNEE_LAT`, i, add(knee, apply(thighR, [0, 0, s * 0.05])));
      put(`${L}_KNEE_MED`, i, add(knee, apply(thighR, [0, 0, -s * 0.05])));
      put(`${L}_ANKLE_LAT`, i, add(ankleReached, apply(shankR, [0, 0, s * 0.035])));
      put(`${L}_ANKLE_MED`, i, add(ankleReached, apply(shankR, [0, 0, -s * 0.035])));
      put(`${L}_HEEL`, i, add(ankleReached, apply(footR, [-0.06, -ANKLE_H + 0.012, 0])));
      put(`${L}_TOE`, i, add(ankleReached, apply(footR, [0.17, -ANKLE_H + 0.012, 0])));
      put(`${L}_MT1`, i, add(ankleReached, apply(footR, [0.13, -ANKLE_H + 0.012, -s * 0.045])));
      put(`${L}_MT5`, i, add(ankleReached, apply(footR, [0.11, -ANKLE_H + 0.012, s * 0.04])));

      // Arms swing opposite to the ipsilateral leg.
      const sho = R([-0.03, 0.5, s * 0.19]);
      const armR = mul(pelvisRot, rotZ(-18 * RAD * Math.cos(2 * Math.PI * (p - 0.92))));
      const elb = add(sho, apply(armR, [0, -0.29, 0]));
      put(`${L}_SHOULDER`, i, sho);
      put(`${L}_ELBOW`, i, elb);
      put(`${L}_WRIST`, i, add(elb, apply(mul(armR, rotZ(20 * RAD)), [0, -0.26, 0])));
    }
  }

  const trajectories = new Map<string, Trajectory>();
  for (const name of names) trajectories.set(name, { name, data: traj.get(name)! });

  const bones: Bone[] = [
    ['HEAD', 'C7'],
    ['L_ASIS', 'R_ASIS'], ['L_PSIS', 'R_PSIS'], ['L_ASIS', 'L_PSIS'], ['R_ASIS', 'R_PSIS'],
    ...(['L', 'R'] as const).flatMap((L): Bone[] => [
      [`${L}_ASIS`, `${L}_HJC`],
      [`${L}_HJC`, `${L}_KNEE_LAT`],
      [`${L}_HJC`, `${L}_KNEE_MED`],
      [`${L}_KNEE_LAT`, `${L}_ANKLE_LAT`],
      [`${L}_KNEE_MED`, `${L}_ANKLE_MED`],
      [`${L}_ANKLE_LAT`, `${L}_HEEL`],
      [`${L}_ANKLE_MED`, `${L}_HEEL`],
      [`${L}_HEEL`, `${L}_MT5`],
      [`${L}_MT5`, `${L}_TOE`],
      [`${L}_TOE`, `${L}_MT1`],
      [`${L}_MT1`, `${L}_HEEL`],
      ['C7', `${L}_SHOULDER`],
      [`${L}_SHOULDER`, `${L}_ELBOW`],
      [`${L}_ELBOW`, `${L}_WRIST`],
    ]),
  ];

  return resolveLandmarks({
    kind: 'motion',
    id: `synthetic-${P.seed}`,
    name: 'synthetic_walk.01',
    format: 'synthetic',
    rate: P.rate,
    frameCount: n,
    trajectories,
    bones,
    landmarks: {},
    meta: {
      cadence_true: P.strideRate * 2,
      stride_length_true: +(P.speed * baseT).toFixed(3),
      step_width_true: P.stepWidth,
      toe_out_true: `l ${P.toeOut.left} / r ${P.toeOut.right}`,
    },
  });
}
