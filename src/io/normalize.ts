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
import { cross, dot, len, norm, sub } from '../core/vec';

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

  return { ...clip, trajectories, meta: { ...clip.meta, unit_scale: unit } };
}
