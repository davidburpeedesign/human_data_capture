/**
 * Bring an imported clip into the lab frame analysis assumes: metres,
 * X anterior (direction of travel), Y up, Z right.
 *
 * Files disagree on all three. BVH is usually Y-up in centimetres, C3D
 * Z-up in millimetres, CSV exports anything. Rather than trust headers we
 * infer from the body itself: "up" is from the feet to the pelvis/head,
 * "forward" is where the pelvis went (or, on a treadmill where it went
 * nowhere, where the toes point). One rigid rotation per trial.
 */
import type { LandmarkId, MotionClip, Vec3 } from '../core/types';
import { track } from '../core/landmarks';
import { RAD, cross, dot, len, norm, sub } from '../core/vec';

function meanPoint(clip: MotionClip, ids: LandmarkId[]): Vec3 | null {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const id of ids) {
    const t = track(clip, id);
    if (!t) continue;
    for (let i = 0; i < t.data.length; i += 3) {
      if (!Number.isFinite(t.data[i])) continue;
      sx += t.data[i]; sy += t.data[i + 1]; sz += t.data[i + 2]; n++;
    }
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}

function firstLast(clip: MotionClip, ids: LandmarkId[]): [Vec3, Vec3] | null {
  for (const id of ids) {
    const t = track(clip, id);
    if (!t) continue;
    let a = -1, b = -1;
    for (let i = 0; i < clip.frameCount; i++) if (Number.isFinite(t.data[i * 3])) { a = i; break; }
    for (let i = clip.frameCount - 1; i >= 0; i--) if (Number.isFinite(t.data[i * 3])) { b = i; break; }
    if (a >= 0 && b > a) {
      return [
        [t.data[a * 3], t.data[a * 3 + 1], t.data[a * 3 + 2]],
        [t.data[b * 3], t.data[b * 3 + 1], t.data[b * 3 + 2]],
      ];
    }
  }
  return null;
}

/** Snap a vector to the nearest signed cardinal axis. Lab data is never diagonal-up. */
function snapAxis(v: Vec3): Vec3 {
  const a = v.map(Math.abs);
  const i = a[0] > a[1] ? (a[0] > a[2] ? 0 : 2) : a[1] > a[2] ? 1 : 2;
  const out: Vec3 = [0, 0, 0];
  out[i] = Math.sign(v[i]) || 1;
  return out;
}

const UPPER: LandmarkId[] = ['SACRUM', 'L_ASIS', 'R_ASIS', 'L_PSIS', 'R_PSIS', 'L_HJC', 'R_HJC', 'C7', 'HEAD'];
const FEET: LandmarkId[] = ['L_HEEL', 'R_HEEL', 'L_TOE', 'R_TOE', 'L_ANKLE_LAT', 'R_ANKLE_LAT'];

export function normalizeClip(clip: MotionClip, opts: { unitScale?: number } = {}): MotionClip {
  const upper = meanPoint(clip, UPPER);
  const feet = meanPoint(clip, FEET);

  const up: Vec3 = upper && feet ? snapAxis(sub(upper, feet)) : [0, 1, 0];

  // Units: a standing pelvis sits ~0.9–1.1 m above the feet.
  let unit = opts.unitScale ?? 1;
  if (opts.unitScale === undefined && upper && feet) {
    const h = Math.abs(dot(sub(upper, feet), up));
    if (h > 100) unit = 0.001;
    else if (h > 10) unit = 0.01;
  }

  // Forward: pelvis displacement, flattened onto the ground plane.
  const flatten = (v: Vec3) => sub(v, up.map((u) => u * dot(v, up)) as Vec3);
  let forward: Vec3 | null = null;
  const path = firstLast(clip, ['SACRUM', 'L_ASIS', 'R_ASIS', 'L_HJC', 'R_HJC']);
  if (path) {
    const d = flatten(sub(path[1], path[0]));
    // Under ~0.5 m of travel we are on a treadmill (or standing): fall back.
    if (len(d) * unit > 0.5) forward = norm(d);
  }
  if (!forward) {
    const heel = meanPoint(clip, ['L_HEEL', 'R_HEEL']);
    const toe = meanPoint(clip, ['L_TOE', 'R_TOE']);
    if (heel && toe) forward = norm(flatten(sub(toe, heel)));
  }
  if (!forward || !Number.isFinite(forward[0])) {
    forward = norm(flatten([1, 0, 0])) ;
    if (!Number.isFinite(forward[0])) forward = norm(flatten([0, 0, 1]));
  }

  const right = norm(cross(forward, up));
  const fwd = norm(cross(up, right));

  // Origin at the first frame's foot centroid, on the floor.
  const feet0 = feet ?? [0, 0, 0];
  let floor = Infinity;
  for (const id of FEET) {
    const t = track(clip, id);
    if (!t) continue;
    for (let i = 1; i < t.data.length; i += 3) {
      const h = dot([t.data[i - 1], t.data[i], t.data[i + 1]], up);
      if (Number.isFinite(h)) floor = Math.min(floor, h);
    }
  }
  const origin: Vec3 = Number.isFinite(floor)
    ? sub(feet0, up.map((u) => u * (dot(feet0, up) - floor)) as Vec3)
    : [0, 0, 0];

  const trajectories = new Map(clip.trajectories);
  for (const [name, t] of trajectories) {
    const d = new Float32Array(t.data.length);
    for (let i = 0; i < d.length; i += 3) {
      const p = sub([t.data[i], t.data[i + 1], t.data[i + 2]], origin);
      d[i] = dot(p, fwd) * unit;
      d[i + 1] = dot(p, up) * unit;
      d[i + 2] = dot(p, right) * unit;
    }
    trajectories.set(name, { ...t, data: d });
  }

  const tilt = levelFloor({ ...clip, trajectories });

  return { ...clip, trajectories, meta: { ...clip.meta, unit_scale: unit, floor_tilt_deg: +tilt.toFixed(2) } };
}

/**
 * Level the walking surface along the direction of travel, in place.
 *
 * Capture volumes are rarely calibrated perfectly level, and skeleton fits
 * drift: CMU trials can climb a few cm over a 4 m walk. Left alone that
 * slope leaks into every height (COM vertical excursion picks up the climb
 * as if it were bob). Fit a line through the lowest foot point in each
 * 20 cm of travel and rotate it out. Returns the correction, degrees.
 *
 * Only pitch along the path is observable from one walking line; on a
 * treadmill (no travel) nothing is changed.
 */
function levelFloor(clip: MotionClip): number {
  const feet = FEET.map((id) => track(clip, id)).filter((t): t is NonNullable<typeof t> => !!t);
  if (!feet.length) return 0;
  const BIN = 0.2;
  const low = new Map<number, number>();
  for (const t of feet) {
    for (let i = 0; i < t.data.length; i += 3) {
      const x = t.data[i], y = t.data[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const b = Math.floor(x / BIN);
      low.set(b, Math.min(low.get(b) ?? Infinity, y));
    }
  }
  if (low.size < 5) return 0;
  // Least-squares slope of floor height against forward position.
  const xs = [...low.keys()].map((b) => (b + 0.5) * BIN);
  const ys = [...low.values()];
  const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
  const my = ys.reduce((a, v) => a + v, 0) / ys.length;
  let sxy = 0, sxx = 0;
  xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; });
  const theta = Math.atan(sxy / sxx);
  // Ignore noise-level slopes, and refuse to "level" a genuine ramp.
  if (!Number.isFinite(theta) || Math.abs(theta) < 0.1 * RAD || Math.abs(theta) > 8 * RAD) return 0;
  const c = Math.cos(theta), sn = Math.sin(theta);
  let floor = Infinity;
  for (const t of clip.trajectories.values()) {
    const d = t.data;
    for (let i = 0; i < d.length; i += 3) {
      const x = d[i], y = d[i + 1];
      d[i] = x * c + y * sn;
      d[i + 1] = -x * sn + y * c;
    }
  }
  for (const t of feet) for (let i = 1; i < t.data.length; i += 3) if (Number.isFinite(t.data[i])) floor = Math.min(floor, t.data[i]);
  for (const t of clip.trajectories.values()) for (let i = 1; i < t.data.length; i += 3) t.data[i] -= floor;
  return theta / RAD;
}
