/**
 * Ground reaction force estimated from motion alone (no force plates).
 *
 * Total force: Newton's second law on the whole-body centre of mass,
 *   F = m (a_com − g)   →   F / (m·|g|) = (a_com − g) / |g|
 * so forces come out in body weights (×BW) and body mass cancels: nothing
 * to ask the user for.
 *
 * Distribution: in single support the stance foot carries all of it. In
 * double support the problem is indeterminate, so we use the smooth
 * transition assumption (after Ren, Jones & Howard, J Biomech 2008): the
 * trailing foot's share falls smoothly from 1 at the leading foot's heel
 * strike to 0 at its own toe-off. We use a cubic ease (zero slope at both
 * ends) for that share, on all three components. Known limitation: a share
 * cannot represent the leading foot braking while the trailing foot
 * propels at the same instant, so individual-foot fore-aft forces in double
 * support are approximate; their sum is exact to the COM estimate.
 *
 * Centre of pressure: rolls from heel to toe along the foot's floor
 * projection over stance, linearly in time. A display anchor for the
 * vector, not a measured COP.
 */
import type { Side, Vec3 } from '../core/types';
import { derivative } from '../core/signal';
import type { Ctx } from './context';
import type { Events } from './events';

export const G = 9.81;

export interface GrfResult {
  /** Total GRF per frame, lab frame, ×BW. */
  total: Vec3[];
  /** Per-foot GRF per frame, lab frame, ×BW; zero in swing. */
  foot: Record<Side, Vec3[]>;
  /** Per-foot centre of pressure on the floor, null in swing. */
  cop: Record<Side, (Vec3 | null)[]>;
  /** Contact flag per foot per frame. */
  contact: Record<Side, boolean[]>;
  method: 'segmental com' | 'pelvis proxy';
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const ease = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return 1 - x * x * (3 - 2 * x); // 1 → 0, flat at both ends
};

/** Per-frame contact from heel strikes / toe offs, inferring the state before the first event. */
function contactSeries(n: number, hs: number[], to: number[]): boolean[] {
  const ev = [...hs.map((f) => [f, 1] as const), ...to.map((f) => [f, 0] as const)].sort((a, b) => a[0] - b[0]);
  const out = new Array<boolean>(n);
  // Before the first event the foot is in contact iff that first event is a toe off.
  let state = ev.length ? ev[0][1] === 0 : false;
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < ev.length && ev[k][0] <= i) state = ev[k++][1] === 1;
    out[i] = state;
  }
  return out;
}

export function estimateGrf(ctx: Ctx, ev: Events, com: { path: Vec3[]; method: string }): GrfResult {
  const n = ctx.n;
  const acc = [0, 1, 2].map((a) => {
    const p = com.path.map((v) => v[a]);
    return derivative(derivative(p, ctx.rate), ctx.rate);
  });
  const total: Vec3[] = acc[0].map((_, i) => [acc[0][i] / G, (acc[1][i] + G) / G, acc[2][i] / G]);

  const contact = {
    left: contactSeries(n, ev.heelStrikes.left, ev.toeOffs.left),
    right: contactSeries(n, ev.heelStrikes.right, ev.toeOffs.right),
  };
  const zero = (): Vec3[] => Array.from({ length: n }, (): Vec3 => [0, 0, 0]);
  const foot: Record<Side, Vec3[]> = { left: zero(), right: zero() };
  const share: Record<Side, number[]> = { left: new Array(n).fill(0), right: new Array(n).fill(0) };

  const lastBefore = (xs: number[], i: number) => {
    let r = -Infinity;
    for (const x of xs) if (x <= i && x > r) r = x;
    return r;
  };
  const firstAfter = (xs: number[], i: number) => {
    let r = Infinity;
    for (const x of xs) if (x > i && x < r) r = x;
    return r;
  };
  const typicalDs = Math.round(0.12 * ctx.rate);

  for (let i = 0; i < n; i++) {
    const l = contact.left[i], r = contact.right[i];
    if (l && r) {
      // Leading foot = the one that struck most recently.
      const hsL = lastBefore(ev.heelStrikes.left, i), hsR = lastBefore(ev.heelStrikes.right, i);
      const lead: Side = hsL >= hsR ? 'left' : 'right';
      const trail = other(lead);
      const t0 = Math.max(hsL, hsR);
      const t1raw = firstAfter(ev.toeOffs[trail], i);
      const start = Number.isFinite(t0) ? t0 : i;
      const end = Number.isFinite(t1raw) ? t1raw : start + typicalDs;
      const s = ease((i - start) / Math.max(1, end - start));
      share[trail][i] = s;
      share[lead][i] = 1 - s;
    } else if (l) share.left[i] = 1;
    else if (r) share.right[i] = 1;
  }
  for (const side of ['left', 'right'] as const) {
    for (let i = 0; i < n; i++) {
      const k = share[side][i];
      // Explicit zeros in swing (k·x would leave -0 in the exports).
      if (k > 0) foot[side][i] = [total[i][0] * k, total[i][1] * k, total[i][2] * k];
    }
  }

  // COP: heel → toe over each contact interval, on the floor.
  const cop: Record<Side, (Vec3 | null)[]> = { left: new Array(n).fill(null), right: new Array(n).fill(null) };
  for (const side of ['left', 'right'] as const) {
    const heel = ctx.ps(side, 'HEEL') ?? ctx.ps(side, 'ANKLE_LAT');
    const toe = ctx.ps(side, 'TOE') ?? heel;
    if (!heel || !toe) continue;
    const c = contact[side];
    let i = 0;
    while (i < n) {
      if (!c[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n && c[j + 1]) j++;
      // An interval clipped by the trial start began before frame 0: assume
      // a typical stance length so the roll-over phase stays plausible.
      const len = Math.max(1, j - i);
      const span = i === 0 && j < n - 1 ? Math.max(len, Math.round(0.6 * ctx.rate)) : len;
      const offset = i === 0 ? span - len : 0;
      for (let f = i; f <= j; f++) {
        const u = Math.min(1, (f - i + offset) / span);
        const h = heel[f], t = toe[f];
        cop[side][f] = [h[0] + (t[0] - h[0]) * u, 0, h[2] + (t[2] - h[2]) * u];
      }
      i = j + 1;
    }
  }

  return { total, foot, cop, contact, method: com.method === 'segmental' ? 'segmental com' : 'pelvis proxy' };
}
