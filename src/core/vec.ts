/**
 * Small, allocation-light vector and rotation helpers. Deliberately not
 * three.js: analysis runs in tests and (later) in a worker, and should not
 * pull a renderer in to subtract two points.
 */
import type { Mat3, Vec3 } from './types';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [NaN, NaN, NaN];
};
export const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const isFinite3 = (a: Vec3) => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

// ── rotation matrices (row-major) ─────────────────────────────────────────

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const rotX = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Build a rotation whose columns are the given (orthonormal) axes. */
export const fromAxes = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [
  x[0], y[0], z[0],
  x[1], y[1], z[1],
  x[2], y[2], z[2],
];

export const axisX = (m: Mat3): Vec3 => [m[0], m[3], m[6]];
export const axisY = (m: Mat3): Vec3 => [m[1], m[4], m[7]];
export const axisZ = (m: Mat3): Vec3 => [m[2], m[5], m[8]];

/**
 * Cardan Z-X-Y decomposition of R = Rz(a)·Rx(b)·Ry(c), returned in radians.
 *
 * With ISB segment axes (X anterior, Y along the segment, Z right) this is
 * the joint coordinate system order used clinically: flexion about the
 * mediolateral axis first, then ab/adduction, then axial rotation about the
 * distal segment's long axis. Gimbal lock is at b = ±90°, which no human
 * lower-limb joint reaches.
 */
export function cardanZXY(r: Mat3): [number, number, number] {
  const b = Math.asin(Math.max(-1, Math.min(1, r[7])));
  const a = Math.atan2(-r[1], r[4]);
  const c = Math.atan2(-r[6], r[8]);
  return [a, b, c];
}
