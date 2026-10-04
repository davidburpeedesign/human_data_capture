/**
 * Per-stride spatiotemporal parameters: the timing and distance skeleton
 * that every other metric hangs off.
 *
 * Distances are measured on the ground plane, along / across the walker's
 * instantaneous heading so curved paths read correctly. Step length uses both
 * heels at the same instant, so it works on a treadmill too; stride length
 * on a treadmill is then the sum of consecutive steps, which equals belt
 * travel plus foot displacement without needing to know the belt speed.
 */
import type { Side, Vec3 } from '../core/types';
import type { Ctx } from './context';
import { rightOf, type Events, type Stride } from './events';

export interface StrideParams {
  side: Side;
  hs: number;
  strideTime: number;     // s
  stanceTime: number;     // s — contact duration
  swingTime: number;      // s
  stancePct: number;      // % of stride
  strideLength: number;   // m
  stepLength: number;     // m — this heel ahead of the other at this heel strike
  stepWidth: number;      // m — mediolateral heel separation at heel strike
  stepTime: number;       // s — from previous contralateral heel strike
  /** Loading: heel strike → contralateral toe off (initial double support). */
  loadingTime: number;    // s
  /** Unloading: contralateral heel strike → toe off (terminal double support). */
  unloadingTime: number;  // s
  footFlatTime: number;   // s after heel strike
  heelOffTime: number;    // s after heel strike
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

export function strideParams(ctx: Ctx, ev: Events, overground: boolean): StrideParams[] {
  const out: StrideParams[] = [];
  const dt = 1 / ctx.rate;

  for (const st of ev.strides) {
    const heel = ctx.ps(st.side, 'HEEL') ?? ctx.ps(st.side, 'ANKLE_LAT');
    const heelO = ctx.ps(other(st.side), 'HEEL') ?? ctx.ps(other(st.side), 'ANKLE_LAT');
    if (!heel) continue;

    const strideTime = (st.next - st.hs) * dt;
    const stanceTime = (st.to - st.hs) * dt;

    // Separation in the walker's own frame at this instant (curve-safe).
    const fwd = (i: number, a: Vec3, b: Vec3) => (a[0] - b[0]) * ev.heading[i][0] + (a[2] - b[2]) * ev.heading[i][2];
    const right = rightOf(ev.heading[st.hs]);
    const stepLength = heelO ? fwd(st.hs, heel[st.hs], heelO[st.hs]) : NaN;
    const stepWidth = heelO ? Math.abs((heel[st.hs][0] - heelO[st.hs][0]) * right[0] + (heel[st.hs][2] - heelO[st.hs][2]) * right[2]) : NaN;

    let strideLength: number;
    if (overground) {
      strideLength = Math.hypot(heel[st.next][0] - heel[st.hs][0], heel[st.next][2] - heel[st.hs][2]);
    } else {
      // Treadmill: this step plus the contralateral step that follows it.
      const nextOther = ev.heelStrikes[other(st.side)].find((h) => h > st.hs && h < st.next);
      strideLength = heelO && nextOther !== undefined ? stepLength + fwd(nextOther, heelO[nextOther], heel[nextOther]) : NaN;
      if (ctx.opts.treadmillSpeed) strideLength = ctx.opts.treadmillSpeed * strideTime;
    }

    const prevOtherHs = [...ev.heelStrikes[other(st.side)]].reverse().find((h) => h < st.hs);
    const otherTo = ev.toeOffs[other(st.side)].find((t) => t > st.hs && t < st.to);
    const otherHs = ev.heelStrikes[other(st.side)].find((h) => h > st.hs && h < st.to);

    out.push({
      side: st.side,
      hs: st.hs,
      strideTime,
      stanceTime,
      swingTime: strideTime - stanceTime,
      stancePct: (100 * stanceTime) / strideTime,
      strideLength,
      stepLength,
      stepWidth,
      stepTime: prevOtherHs !== undefined ? (st.hs - prevOtherHs) * dt : NaN,
      loadingTime: otherTo !== undefined ? (otherTo - st.hs) * dt : NaN,
      unloadingTime: otherHs !== undefined ? (st.to - otherHs) * dt : NaN,
      footFlatTime: (st.footFlat - st.hs) * dt,
      heelOffTime: (st.heelOff - st.hs) * dt,
    });
  }
  return out;
}

export type { Stride };
