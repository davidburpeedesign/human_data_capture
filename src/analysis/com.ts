/**
 * Centre-of-mass trajectory.
 *
 * With a full-body landmark set we use a segmental model (Dempster mass
 * fractions and COM positions as tabulated by Winter, 2009). With only a
 * lower-body set, the pelvis centroid is the accepted proxy: it tracks the
 * true COM to within a couple of centimetres in walking.
 */
import type { Vec3 } from '../core/types';
import { add, mid, scale, sub } from '../core/vec';
import type { Ctx } from './context';
import type { Segments } from './segments';

export interface ComResult {
  path: Vec3[];
  method: 'segmental' | 'pelvis proxy';
}

/** [mass fraction, COM position from proximal end as fraction of length]. */
const DEMPSTER = {
  thigh: [0.1, 0.433],
  shank: [0.0465, 0.433],
  foot: [0.0145, 0.5],
  upperArm: [0.028, 0.436],
  forearmHand: [0.022, 0.682],
  trunk: [0.497, 0.5],   // thorax + abdomen + pelvis, C7 → hip midpoint
  headNeck: [0.081, 1],  // at the head landmark
} as const;

const along = (a: Vec3, b: Vec3, f: number) => add(a, scale(sub(b, a), f));

export function computeCom(ctx: Ctx, segs: Segments, pelvis: Vec3[] | null): ComResult | null {
  const c7 = ctx.p('C7'), head = ctx.p('HEAD');
  const { hjc, kneeCentre: kc, ankleCentre: ac } = segs;
  const heel = { left: ctx.ps('left', 'HEEL'), right: ctx.ps('right', 'HEEL') };
  const toe = { left: ctx.ps('left', 'TOE'), right: ctx.ps('right', 'TOE') };
  const sho = { left: ctx.ps('left', 'SHOULDER'), right: ctx.ps('right', 'SHOULDER') };
  const elb = { left: ctx.ps('left', 'ELBOW'), right: ctx.ps('right', 'ELBOW') };
  const wri = { left: ctx.ps('left', 'WRIST'), right: ctx.ps('right', 'WRIST') };

  const fullBody =
    c7 && head && hjc.left && hjc.right &&
    kc.left && kc.right && ac.left && ac.right &&
    heel.left && heel.right && toe.left && toe.right;

  if (!fullBody) return pelvis ? { path: pelvis, method: 'pelvis proxy' } : null;

  const path: Vec3[] = [];
  for (let i = 0; i < ctx.n; i++) {
    let sum: Vec3 = [0, 0, 0];
    let mass = 0;
    const addSeg = (m: number, p: Vec3) => { sum = add(sum, scale(p, m)); mass += m; };

    const hipMid = mid(hjc.left![i], hjc.right![i]);
    addSeg(DEMPSTER.trunk[0], along(c7![i], hipMid, DEMPSTER.trunk[1]));
    addSeg(DEMPSTER.headNeck[0], head![i]);

    for (const s of ['left', 'right'] as const) {
      addSeg(DEMPSTER.thigh[0], along(hjc[s]![i], kc[s]![i], DEMPSTER.thigh[1]));
      addSeg(DEMPSTER.shank[0], along(kc[s]![i], ac[s]![i], DEMPSTER.shank[1]));
      addSeg(DEMPSTER.foot[0], mid(heel[s]![i], toe[s]![i]));
      if (sho[s] && elb[s]) addSeg(DEMPSTER.upperArm[0], along(sho[s]![i], elb[s]![i], DEMPSTER.upperArm[1]));
      if (elb[s] && wri[s]) addSeg(DEMPSTER.forearmHand[0], along(elb[s]![i], wri[s]![i], DEMPSTER.forearmHand[1]));
    }
    // Normalise by the mass we actually placed; missing arms shift little.
    path.push(scale(sum, 1 / mass));
  }
  return { path, method: 'segmental' };
}
