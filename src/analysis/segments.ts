/**
 * Segment coordinate systems from landmarks: pelvis, thigh, shank, foot.
 *
 * Every frame follows ISB axes: X anterior, Y superior / along the segment,
 * Z right, for *both* sides. Side-specific clinical signs (internal
 * rotation, inversion) are applied when angles are extracted, not here.
 *
 * Each segment needs a long axis (two points) and a mediolateral hint.
 * Axial rotation, which is the whole point of tibial/knee rotation and
 * pronation, is only observable if the hint comes from markers on *that*
 * segment. When it doesn't, we fall back to a neighbouring segment's axis
 * and mark the segment `proxy`, which propagates to any metric using it.
 */
import type { Mat3, Side, Vec3 } from '../core/types';
import { add, cross, dot, fromAxes, mid, norm, scale, sub } from '../core/vec';
import type { Ctx } from './context';

export type Quality = 'full' | 'proxy';

export interface SegmentSeries {
  frames: Mat3[];
  origin: Vec3[];
  quality: Quality;
  /** Which landmarks were missing and forced a fallback, for the readout. */
  note?: string;
}

const sgn = (side: Side) => (side === 'right' ? 1 : -1);

/** Long axis = Y; ML hint orthogonalised into Z. */
function frameFromY(y: Vec3, hint: Vec3): Mat3 {
  const Y = norm(y);
  const Z = norm(sub(hint, scale(Y, dot(hint, Y))));
  const X = cross(Y, Z);
  return fromAxes(X, Y, Z);
}

/** Long axis = X (the foot); ML hint orthogonalised into Z. */
function frameFromX(x: Vec3, hint: Vec3): Mat3 {
  const X = norm(x);
  const Z = norm(sub(hint, scale(X, dot(hint, X))));
  const Y = cross(Z, X);
  return fromAxes(X, Y, Z);
}

export interface Segments {
  pelvis: SegmentSeries | null;
  hjc: Record<Side, Vec3[] | null>;
  kneeCentre: Record<Side, Vec3[] | null>;
  ankleCentre: Record<Side, Vec3[] | null>;
  thigh: Record<Side, SegmentSeries | null>;
  shank: Record<Side, SegmentSeries | null>;
  foot: Record<Side, SegmentSeries | null>;
}

export function buildSegments(ctx: Ctx): Segments {
  const { n } = ctx;

  // ── pelvis ────────────────────────────────────────────────────────────
  const lasi = ctx.p('L_ASIS'), rasi = ctx.p('R_ASIS');
  const lpsi = ctx.p('L_PSIS'), rpsi = ctx.p('R_PSIS');
  const sacr = ctx.p('SACRUM');
  let pelvis: SegmentSeries | null = null;
  if (lasi && rasi && ((lpsi && rpsi) || sacr)) {
    const frames: Mat3[] = [], origin: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const asis = mid(lasi[i], rasi[i]);
      const back = lpsi && rpsi ? mid(lpsi[i], rpsi[i]) : sacr![i];
      const Z = norm(sub(rasi[i], lasi[i]));
      const X = norm(sub(sub(asis, back), scale(Z, dot(sub(asis, back), Z))));
      frames.push(fromAxes(X, cross(Z, X), Z));
      origin.push(asis);
    }
    pelvis = { frames, origin, quality: 'full' };
  }

  // ── hip joint centres ────────────────────────────────────────────────
  const hjc = { left: ctx.ps('left', 'HJC'), right: ctx.ps('right', 'HJC') };
  if (pelvis && lasi && rasi) {
    // Harrington et al. 2007 regression, used only when no HJC was supplied.
    for (const side of ['left', 'right'] as const) {
      if (hjc[side]) continue;
      const out: Vec3[] = [];
      for (let i = 0; i < n; i++) {
        const pw = Math.hypot(...sub(rasi[i], lasi[i]));
        const back = lpsi && rpsi ? mid(lpsi[i], rpsi[i]) : sacr![i];
        const pd = Math.hypot(...sub(pelvis.origin[i], back));
        const f = pelvis.frames[i];
        const local: Vec3 = [-0.24 * pd - 0.0099, -0.3 * pw - 0.0109, sgn(side) * (0.33 * pw + 0.0073)];
        out.push(add(pelvis.origin[i], [
          f[0] * local[0] + f[1] * local[1] + f[2] * local[2],
          f[3] * local[0] + f[4] * local[1] + f[5] * local[2],
          f[6] * local[0] + f[7] * local[1] + f[8] * local[2],
        ]));
      }
      hjc[side] = out;
    }
  }

  const pelvisZ = (i: number): Vec3 => (pelvis ? [pelvis.frames[i][2], pelvis.frames[i][5], pelvis.frames[i][8]] : [0, 0, 1]);

  const centre = (a: Vec3[] | null, b: Vec3[] | null) => (a && b ? a.map((p, i) => mid(p, b[i])) : a);

  const segs: Segments = {
    pelvis,
    hjc,
    kneeCentre: { left: null, right: null },
    ankleCentre: { left: null, right: null },
    thigh: { left: null, right: null },
    shank: { left: null, right: null },
    foot: { left: null, right: null },
  };

  for (const side of ['left', 'right'] as const) {
    const s = sgn(side);
    const kl = ctx.ps(side, 'KNEE_LAT'), km = ctx.ps(side, 'KNEE_MED');
    const al = ctx.ps(side, 'ANKLE_LAT'), am = ctx.ps(side, 'ANKLE_MED');
    const heel = ctx.ps(side, 'HEEL'), toe = ctx.ps(side, 'TOE');
    const mt1 = ctx.ps(side, 'MT1'), mt5 = ctx.ps(side, 'MT5');

    const kc = centre(kl, km);
    const ac = centre(al, am);
    segs.kneeCentre[side] = kc;
    segs.ankleCentre[side] = ac;

    // Lateral-minus-medial, flipped on the left, always points to lab right.
    const mlHint = (lat: Vec3[] | null, med: Vec3[] | null) =>
      lat && med ? (i: number) => scale(sub(lat[i], med[i]), s) : null;

    const hip = hjc[side];
    if (hip && kc) {
      const hint = mlHint(kl, km);
      segs.thigh[side] = {
        frames: hip.map((h, i) => frameFromY(sub(h, kc[i]), hint ? hint(i) : pelvisZ(i))),
        origin: hip,
        quality: hint ? 'full' : 'proxy',
        note: hint ? undefined : 'no medial knee marker: thigh rotation follows pelvis',
      };
    }

    if (kc && ac) {
      const hint = mlHint(al, am) ?? mlHint(kl, km);
      segs.shank[side] = {
        frames: kc.map((k, i) => frameFromY(sub(k, ac[i]), hint ? hint(i) : pelvisZ(i))),
        origin: kc,
        quality: mlHint(al, am) ? 'full' : 'proxy',
        note: mlHint(al, am) ? undefined : 'no medial malleolus marker: shank rotation estimated',
      };
    }

    if (heel && toe) {
      const forefoot = mt1 && mt5 ? (i: number) => scale(sub(mt5[i], mt1[i]), s) : null;
      const hint = forefoot ?? mlHint(al, am);
      segs.foot[side] = {
        frames: heel.map((h, i) => frameFromX(sub(toe[i], h), hint ? hint(i) : pelvisZ(i))),
        origin: ac ?? heel,
        quality: forefoot ? 'full' : 'proxy',
        note: forefoot ? undefined : 'no MT1/MT5 markers: foot inversion not observable',
      };
    }
  }

  return segs;
}
