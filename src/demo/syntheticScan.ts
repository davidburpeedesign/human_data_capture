/**
 * A procedural standing-body point cloud: superellipse cross-sections
 * lofted along a stature profile. Stands in for a real scan so the scan
 * view and girth analysis have something to chew on out of the box.
 */
import type { BodyScan } from '../core/types';

/** [height fraction, half-width (z), half-depth (x)] in metres for a 1.75 m body. */
const TORSO: [number, number, number][] = [
  [0.47, 0.17, 0.11], [0.52, 0.18, 0.12], [0.57, 0.16, 0.1], [0.62, 0.145, 0.095],
  [0.67, 0.155, 0.1], [0.72, 0.17, 0.115], [0.77, 0.18, 0.105], [0.81, 0.15, 0.08],
  [0.83, 0.06, 0.06], [0.86, 0.055, 0.055],
];
const HEAD: [number, number, number][] = [
  [0.87, 0.07, 0.08], [0.9, 0.08, 0.1], [0.94, 0.08, 0.1], [0.98, 0.06, 0.08], [1.0, 0.02, 0.03],
];
const LEG: [number, number][] = [ // [height fraction, radius]
  [0.02, 0.035], [0.06, 0.035], [0.12, 0.045], [0.2, 0.058], [0.26, 0.05],
  [0.29, 0.05], [0.35, 0.07], [0.44, 0.085], [0.49, 0.09],
];

function interp<T extends number[]>(table: T[], f: number): T | null {
  if (f < table[0][0] || f > table[table.length - 1][0]) return null;
  for (let i = 0; i + 1 < table.length; i++) {
    const a = table[i], b = table[i + 1];
    if (f >= a[0] && f <= b[0]) {
      const t = (f - a[0]) / (b[0] - a[0] || 1);
      return a.map((v, k) => v + (b[k] - v) * t) as T;
    }
  }
  return null;
}

export function syntheticScan(stature = 1.75, density = 1): BodyScan {
  const pts: number[] = [];
  const s = stature / 1.75;
  const ring = (cy: number, cx: number, cz: number, rx: number, rz: number, n: number, e = 2.6) => {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + Math.random() * 0.5)) / n;
      const c = Math.cos(a), sn = Math.sin(a);
      // Superellipse: squarer than an ellipse, closer to a torso section.
      const x = Math.sign(c) * Math.abs(c) ** (2 / e) * rx;
      const z = Math.sign(sn) * Math.abs(sn) ** (2 / e) * rz;
      pts.push(cx + x, cy, cz + z);
    }
  };

  const rows = Math.round(320 * density);
  for (let r = 0; r <= rows; r++) {
    const f = r / rows;
    const y = f * stature;
    const torso = interp(TORSO, f) ?? interp(HEAD, f);
    if (torso) ring(y, 0, 0, torso[2] * s, torso[1] * s, Math.round(170 * density));
    const leg = interp(LEG, f);
    if (leg) {
      for (const side of [-1, 1]) ring(y, f < 0.06 ? 0.04 * s : 0, side * 0.09 * s, leg[1] * s, leg[1] * s * 0.95, Math.round(40 * density), 2.1);
    }
    // Arms hang beside the torso from shoulder to wrist.
    if (f > 0.42 && f < 0.8) {
      const t = (f - 0.42) / 0.38;
      const rad = (0.03 + 0.017 * t) * s;
      for (const side of [-1, 1]) ring(y, 0, side * (0.25 - 0.015 * t) * s, rad, rad, Math.round(26 * density), 2.1);
    }
  }
  // Feet: a flattened loop at floor level pointing forward.
  for (let r = 0; r < 12; r++) {
    const y = (r / 12) * 0.05 * s;
    for (const side of [-1, 1]) ring(y, 0.06 * s, side * 0.09 * s, 0.13 * s * (1 - r / 20), 0.045 * s, 50, 2.4);
  }

  return {
    kind: 'scan',
    id: 'synthetic-scan',
    name: 'synthetic_scan.01',
    format: 'ply',
    positions: new Float32Array(pts),
    indices: null,
    colors: null,
    meta: { vertices: pts.length / 3, stature_true: stature },
  };
}
