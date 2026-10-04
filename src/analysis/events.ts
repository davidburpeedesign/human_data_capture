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
    const win = Math.round(0.15 * ctx.rate);
    heelStrikes[side] = findPeaks(heelRel, minGap, prominence).map((h) => refineContact(heel, toe, h, win, 'on'));
    toeOffs[side] = findPeaks(toeRel, minGap, prominence).map((t) => refineContact(heel, toe, t, win, 'off'));

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
      });
    }
  }

  return { heelStrikes, toeOffs, strides, pelvis, heading, speed };
}

/**
 * Zeni events lead true contact slightly, because the heel decelerates
 * before it lands. Snap each event to the frame the foot's lowest marker
 * crosses 1 cm above its floor level, if that happens within ±`win`
 * frames. Using the lower of heel and toe keeps forefoot strikers working.
 */
function refineContact(heel: Vec3[], toe: Vec3[], frame: number, win: number, edge: 'on' | 'off'): number {
  const n = heel.length;
  const low = (i: number) => Math.min(heel[i][1], toe[i][1]);
  const a = Math.max(0, frame - win), b = Math.min(n - 1, frame + win);
  let floor = Infinity;
  // Floor level from the stance side of the event: after contact, before lift.
  const s0 = edge === 'on' ? frame : Math.max(0, frame - 2 * win);
  const s1 = edge === 'on' ? Math.min(n - 1, frame + 2 * win) : frame;
  for (let i = s0; i <= s1; i++) floor = Math.min(floor, low(i));
  const thresh = floor + 0.01;
  if (edge === 'on') {
    for (let i = a; i <= b; i++) if (low(i) < thresh) return i;
  } else {
    for (let i = b; i >= a; i--) if (low(i) < thresh) return i;
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
