/**
 * Joint and segment angle time series, in degrees, with clinical signs:
 *
 *   hip     flexion +, adduction +, internal rotation +
 *   knee    flexion +, adduction (varus) +, internal tibial rotation +
 *   ankle   dorsiflexion +, inversion + / eversion −, adduction +
 *   tibia   axial rotation of the shank vs. direction of travel, internal +
 *   fpa     foot progression angle vs. direction of travel, toe-out +
 *
 * Joint angles use a Z-X-Y Cardan sequence of the distal frame relative to
 * the proximal (see `cardanZXY`). Left-side ab/adduction and rotation are
 * sign-flipped so that "internal" means the same thing on both legs.
 */
import type { Mat3, Side, Vec3 } from '../core/types';
import { DEG, cardanZXY, mul, rotY, transpose } from '../core/vec';
import type { Quality, SegmentSeries, Segments } from './segments';

export interface AngleSeries {
  id: string;
  label: string;
  values: number[];
  quality: Quality;
}

export type SideAngles = Record<string, AngleSeries>;

const sgn = (side: Side) => (side === 'right' ? 1 : -1);

const worst = (...q: Quality[]): Quality => (q.includes('proxy') ? 'proxy' : 'full');

function joint(prox: SegmentSeries, dist: SegmentSeries) {
  return prox.frames.map((p, i) => cardanZXY(mul(transpose(p), dist.frames[i])));
}

/**
 * Lab → walker frame: undo the heading's yaw so segment orientations are
 * read relative to the direction of travel, not a fixed lab axis.
 */
function toWalkerFrame(heading: Vec3[]): Mat3[] {
  return heading.map((h) => transpose(rotY(Math.atan2(-h[2], h[0]))));
}

export function computeAngles(segs: Segments, heading?: Vec3[]): Record<Side, SideAngles> {
  const walker = heading ? toWalkerFrame(heading) : null;
  const inWalker = (f: Mat3, i: number) => (walker ? mul(walker[i], f) : f);
  const out: Record<Side, SideAngles> = { left: {}, right: {} };

  for (const side of ['left', 'right'] as const) {
    const s = sgn(side);
    const a = out[side];
    const { thigh, shank, foot } = { thigh: segs.thigh[side], shank: segs.shank[side], foot: segs.foot[side] };

    if (segs.pelvis && thigh) {
      const j = joint(segs.pelvis, thigh);
      const q = worst(segs.pelvis.quality, thigh.quality);
      a.hipFlex = { id: 'hipFlex', label: 'hip flexion', values: j.map((r) => r[0] * DEG), quality: 'full' };
      a.hipAdd = { id: 'hipAdd', label: 'hip adduction', values: j.map((r) => s * r[1] * DEG), quality: 'full' };
      a.hipRot = { id: 'hipRot', label: 'hip rotation', values: j.map((r) => s * r[2] * DEG), quality: q };
    }

    if (thigh && shank) {
      const j = joint(thigh, shank);
      const q = worst(thigh.quality, shank.quality);
      a.kneeFlex = { id: 'kneeFlex', label: 'knee flexion', values: j.map((r) => -r[0] * DEG), quality: 'full' };
      a.kneeAdd = { id: 'kneeAdd', label: 'knee varus', values: j.map((r) => s * r[1] * DEG), quality: q };
      a.kneeRot = { id: 'kneeRot', label: 'knee rotation', values: j.map((r) => s * r[2] * DEG), quality: q };
    }

    if (shank && foot) {
      const j = joint(shank, foot);
      const q = worst(shank.quality, foot.quality);
      a.ankleDorsi = { id: 'ankleDorsi', label: 'ankle dorsiflexion', values: j.map((r) => r[0] * DEG), quality: 'full' };
      a.ankleInv = { id: 'ankleInv', label: 'inversion / eversion', values: j.map((r) => s * r[1] * DEG), quality: q };
      a.ankleAdd = { id: 'ankleAdd', label: 'foot adduction', values: j.map((r) => s * r[2] * DEG), quality: q };
    }

    if (shank) {
      a.tibiaRot = {
        id: 'tibiaRot',
        label: 'tibial rotation',
        values: shank.frames.map((f: Mat3, i) => s * cardanZXY(inWalker(f, i))[2] * DEG),
        quality: shank.quality,
      };
    }

    if (foot) {
      // Heading of the foot's long axis on the ground plane vs. direction of travel.
      a.fpa = {
        id: 'fpa',
        label: 'foot progression',
        values: foot.frames.map((f, i) => {
          const w = inWalker(f, i);
          return Math.atan2(s * w[6], w[0]) * DEG;
        }),
        quality: 'full',
      };
    }
  }

  return out;
}
