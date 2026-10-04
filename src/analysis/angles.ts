/**
 * Joint and segment angle time series, in degrees, with clinical signs:
 *
 *   hip     flexion +, adduction +, internal rotation +
 *   knee    flexion +, adduction (varus) +, internal tibial rotation +
 *   ankle   dorsiflexion +, inversion + / eversion −, adduction +
 *   tibia   axial rotation of the shank in the lab, internal +
 *   fpa     foot progression angle, toe-out +
 *
 * Joint angles use a Z-X-Y Cardan sequence of the distal frame relative to
 * the proximal (see `cardanZXY`). Left-side ab/adduction and rotation are
 * sign-flipped so that "internal" means the same thing on both legs.
 */
import type { Mat3, Side } from '../core/types';
import { DEG, cardanZXY, mul, transpose } from '../core/vec';
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

export function computeAngles(segs: Segments): Record<Side, SideAngles> {
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
        values: shank.frames.map((f: Mat3) => s * cardanZXY(f)[2] * DEG),
        quality: shank.quality,
      };
    }

    if (foot) {
      // Heading of the foot's long axis on the ground plane vs. +X (travel).
      a.fpa = {
        id: 'fpa',
        label: 'foot progression',
        values: foot.frames.map((f) => Math.atan2(s * f[6], f[0]) * DEG),
        quality: 'full',
      };
    }
  }

  return out;
}
