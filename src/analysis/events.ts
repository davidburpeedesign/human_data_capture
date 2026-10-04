/**
 * Gait event detection from kinematics alone (no force plates).
 *
 * Zeni et al. (2008): relative to the pelvis, the heel is furthest forward
 * at heel strike and the toe is furthest back at toe off. This is robust on
 * both treadmill and overground trials, because subtracting the pelvis
 * removes walking speed from the signal. "Forward" is the instantaneous
 * direction of travel, so curved paths work too.
 *
 * Foot-flat and heel-off (used for loading/unloading timing) come from the
 * heel/toe marker heights relative to their stance minima.
 */
import type { Side, Vec3 } from '../core/types';
import { derivative, findPeaks, lowpass } from '../core/signal';
import { mid } from '../core/vec';
import type { Ctx } from './context';

export interface Stride {
  side: Side;
  /** Frame indices. `next` is the following ipsilateral heel strike. */
  hs: number;
  to: number;
  next: number;
  /** Optional sub-phase events, NaN when not resolvable. */
  footFlat: number;
  heelOff: number;
  /**
   * The clip ended before the next ipsilateral heel strike: the stance is
   * real, `next` is an estimate (typical stride length) and may lie past
   * the last frame. Short trials, especially running, often hold only one
   * complete stride per side or none, and dropping the final stance would
   * leave a side with no data at all.
   */
  partial: boolean;
}

export interface Events {
  heelStrikes: Record<Side, number[]>;
  toeOffs: Record<Side, number[]>;
  strides: Stride[];
  /** Frame-wise pelvis reference used for detection; reused for COM fallback. */
  pelvis: Vec3[] | null;
  /**
   * Unit direction of travel per frame, on the ground plane. Follows the
   * walker round curves; +X when the pelvis isn't going anywhere (treadmill).
   */
  heading: Vec3[];
  /** Smoothed horizontal pelvis speed per frame, m/s. */
  speed: number[];
}

/** Lab-right for a heading: forward × up. */
export const rightOf = (h: Vec3): Vec3 => [-h[2], 0, h[0]];

/**
 * Direction of travel from the pelvis's horizontal velocity, low-passed
 * well below step frequency (0.4 Hz) so the side-to-side sway of each step
 * doesn't swing the heading. CMU and most overground trials curve; a single
 * global "forward" axis would rotate every per-step measure on a bend.
 */
function headingSeries(pelvis: Vec3[], rate: number): { heading: Vec3[]; speed: number[] } {
  const vx = lowpass(derivative(pelvis.map((p) => p[0]), rate), rate, 0.4);
  const vz = lowpass(derivative(pelvis.map((p) => p[2]), rate), rate, 0.4);
  const speed = vx.map((x, i) => Math.hypot(x, vz[i]));
  // Below walking pace the direction is noise; hold the lab axis instead.
  const heading = speed.map((s, i): Vec3 => (s > 0.15 ? [vx[i] / s, 0, vz[i] / s] : [1, 0, 0]));
  return { heading, speed };
}

/** Pelvis centroid from whatever pelvic landmarks exist. */
export function pelvisCentre(ctx: Ctx): Vec3[] | null {
  const lasi = ctx.p('L_ASIS'), rasi = ctx.p('R_ASIS');
  const lpsi = ctx.p('L_PSIS'), rpsi = ctx.p('R_PSIS');
  const sacr = ctx.p('SACRUM');
  const lh = ctx.p('L_HJC'), rh = ctx.p('R_HJC');
  if (lasi && rasi && lpsi && rpsi) {
    return lasi.map((_, i) => mid(mid(lasi[i], rasi[i]), mid(lpsi[i], rpsi[i])));
  }
  if (lasi && rasi && sacr) return lasi.map((_, i) => mid(mid(lasi[i], rasi[i]), sacr[i]));
  if (sacr) return sacr;
  if (lh && rh) return lh.map((_, i) => mid(lh[i], rh[i]));
  return null;
}

export function detectEvents(ctx: Ctx): Events {
  const pelvis = pelvisCentre(ctx);
  const heelStrikes: Record<Side, number[]> = { left: [], right: [] };
  const toeOffs: Record<Side, number[]> = { left: [], right: [] };
  const strides: Stride[] = [];

  if (!pelvis) {
    return { heelStrikes, toeOffs, strides, pelvis, heading: Array.from({ length: ctx.n }, (): Vec3 => [1, 0, 0]), speed: new Array(ctx.n).fill(0) };
  }
  const { heading, speed } = headingSeries(pelvis, ctx.rate);
  const along = (p: Vec3, i: number) => (p[0] - pelvis[i][0]) * heading[i][0] + (p[2] - pelvis[i][2]) * heading[i][2];

  // Steps are ≥ ~0.35 s even when running; half that keeps doubles apart.
  const minGap = Math.max(3, Math.round(0.35 * ctx.rate));
  const prominence = 0.03; // metres

  for (const side of ['left', 'right'] as const) {
    const heel = ctx.ps(side, 'HEEL') ?? ctx.ps(side, 'ANKLE_LAT');
    const toe = ctx.ps(side, 'TOE') ?? heel;
    if (!heel || !toe) continue;

    const heelRel = heel.map((h, i) => along(h, i));
    const toeRel = toe.map((t, i) => -along(t, i));
    // Both signals fall while the foot is planted: heel forward of pelvis
    // shrinks after contact; toe forward of pelvis shrinks until lift-off.
    const toeAlong = toeRel.map((v) => -v);
    heelStrikes[side] = findPeaks(heelRel, minGap, prominence).map((h) => refineContact(heelRel, ctx.rate, h, 'on'));
    toeOffs[side] = findPeaks(toeRel, minGap, prominence).map((t) => refineContact(toeAlong, ctx.rate, t, 'off'));

    const hs = heelStrikes[side];
    for (let k = 0; k + 1 < hs.length; k++) {
      const to = toeOffs[side].find((t) => t > hs[k] && t < hs[k + 1]);
      if (to === undefined) continue;
      strides.push({
        side,
        hs: hs[k],
        to,
        next: hs[k + 1],
        ...subPhases(heel, toe, hs[k], to),
        partial: false,
      });
    }
  }

  // Trailing stances: the last heel strike of a side, with its toe-off in the
  // clip but no following heel strike. Cycle length is estimated from the
  // trial itself: a complete stride if there is one, else two steps.
  const strideFrames = typicalStride(strides, heelStrikes);
  if (strideFrames) {
    for (const side of ['left', 'right'] as const) {
      const heel = ctx.ps(side, 'HEEL') ?? ctx.ps(side, 'ANKLE_LAT');
      const toe = ctx.ps(side, 'TOE') ?? heel;
      const last = heelStrikes[side][heelStrikes[side].length - 1];
      if (!heel || !toe || last === undefined) continue;
      const to = toeOffs[side].find((t) => t > last);
      if (to === undefined) continue;
      strides.push({ side, hs: last, to, next: last + strideFrames, ...subPhases(heel, toe, last, to), partial: true });
    }
  }

  return { heelStrikes, toeOffs, strides, pelvis, heading, speed };
}

/**
 * Zeni peaks mark where the foot moves *with* the pelvis (zero relative
 * velocity), which is a little before a heel lands and a little after a toe
 * lifts. Planted, a foot moves backward relative to the pelvis at walking
 * speed (or belt speed, on a treadmill). So snap each event to where the
 * signal's slope joins / leaves that stance slope: contact is the first
 * frame after the peak reaching 80 % of it, lift-off the last frame before.
 *
 * Velocity-based on purpose. Height thresholds misfire whenever the swing
 * heel skims low over the floor, which skeleton-derived heels (CMU ASF/AMC)
 * routinely do while still travelling at several m/s.
 */
function refineContact(signal: number[], rate: number, frame: number, edge: 'on' | 'off'): number {
  const n = signal.length;
  const slope = (i: number) => (signal[Math.min(n - 1, i + 1)] - signal[Math.max(0, i - 1)]) * rate / 2;
  // Stance slope: median over 0.1–0.25 s into stance from the peak.
  const dir = edge === 'on' ? 1 : -1;
  const near = Math.round(0.1 * rate), far = Math.round(0.25 * rate);
  const samples: number[] = [];
  for (let k = near; k <= far; k++) {
    const i = frame + dir * k;
    if (i > 0 && i < n - 1) samples.push(slope(i));
  }
  if (samples.length < 3) return frame;
  samples.sort((x, y) => x - y);
  const stance = samples[samples.length >> 1];
  // Stance slope is negative for both signals (heel and toe recede).
  if (!(stance < 0)) return frame;
  for (let k = 0; k <= far; k++) {
    const i = frame + dir * k;
    if (i <= 0 || i >= n - 1) break;
    if (slope(i) <= 0.8 * stance) return i;
  }
  return frame;
}

/**
 * Foot-flat and heel-off from the heel→toe pitch. The flat phase is the
 * longest part of stance, so the median stance pitch is the flat-foot
 * reference; marker heights alone are fooled by a toe marker that dips as
 * the foot rolls over the forefoot.
 */
function subPhases(heel: Vec3[], toe: Vec3[], hs: number, to: number) {
  const pitch: number[] = [];
  for (let i = hs; i <= to; i++) {
    const d = [toe[i][0] - heel[i][0], toe[i][1] - heel[i][1], toe[i][2] - heel[i][2]];
    pitch.push(Math.atan2(d[1], Math.hypot(d[0], d[2])) * (180 / Math.PI));
  }
  const flat = [...pitch].sort((a, b) => a - b)[Math.floor(pitch.length / 2)];
  let footFlat = NaN, heelOff = NaN;
  const ff = pitch.findIndex((p) => p < flat + 2);
  if (ff >= 0) {
    footFlat = hs + ff;
    const ho = pitch.findIndex((p, k) => k > ff && p < flat - 3);
    if (ho >= 0) heelOff = hs + ho;
  }
  return { footFlat, heelOff };
}

/** Median stride length in frames, from complete strides or, failing that, steps. */
function typicalStride(strides: Stride[], hs: Record<Side, number[]>): number | null {
  const median = (x: number[]) => [...x].sort((a, b) => a - b)[x.length >> 1];
  if (strides.length) return median(strides.map((s) => s.next - s.hs));
  const all = [...hs.left.map((f) => [f, 0]), ...hs.right.map((f) => [f, 1])].sort((a, b) => a[0] - b[0]);
  const steps: number[] = [];
  for (let i = 1; i < all.length; i++) if (all[i][1] !== all[i - 1][1]) steps.push(all[i][0] - all[i - 1][0]);
  return steps.length ? 2 * median(steps) : null;
}
