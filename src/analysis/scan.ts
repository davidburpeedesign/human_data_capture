/**
 * Body-scan anthropometrics: overall dimensions, surface area and volume
 * for meshes, and a girth profile from horizontal slices.
 *
 * Girth = perimeter of the convex hull of each connected blob in a thin
 * horizontal slice. The hull bridges concavities (the small of the back),
 * so it reads like a tape measure, which is also what a tailor gets. Blobs
 * are found on a 1 cm grid so two legs, or an arm beside the torso, are
 * measured separately instead of as one hull around both.
 */
import type { BodyScan } from '../core/types';

export interface SliceGirth {
  height: number;     // m above floor
  loops: number[];    // perimeter per blob, m, largest first
}

export interface ScanReport {
  height: number;
  width: number;
  depth: number;
  vertices: number;
  surfaceArea: number | null; // m²
  volume: number | null;      // m³, only meaningful for closed meshes
  profile: SliceGirth[];
  /** Landmark girths at standard stature fractions. Heuristic placement. */
  girths: { id: string; label: string; height: number; value: number }[];
}

type P2 = [number, number];

function hullPerimeter(pts: P2[]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

/** Group slice points into blobs by 8-connected occupancy on a coarse grid. */
function blobs(pts: P2[], cell = 0.012): P2[][] {
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, P2[]>();
  for (const p of pts) {
    const k = key(p[0], p[1]);
    const list = grid.get(k);
    if (list) list.push(p); else grid.set(k, [p]);
  }
  const seen = new Set<string>();
  const out: P2[][] = [];
  for (const start of grid.keys()) {
    if (seen.has(start)) continue;
    const blob: P2[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      blob.push(...grid.get(k)!);
      const [cx, cz] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nk = `${cx + dx},${cz + dz}`;
        if (grid.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    out.push(blob);
  }
  return out;
}

export function analyzeScan(scan: BodyScan, sliceStep = 0.02): ScanReport {
  const pos = scan.positions;
  const nv = pos.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], pos[i + a]);
      max[a] = Math.max(max[a], pos[i + a]);
    }
  }
  const height = max[1] - min[1];

  let surfaceArea: number | null = null, volume: number | null = null;
  if (scan.indices) {
    let area = 0, vol = 0;
    const ix = scan.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      area += Math.hypot(cx, cy, cz) / 2;
      // Signed tetrahedron volume against the origin (divergence theorem).
      vol += (pos[a] * cx + pos[a + 1] * cy + pos[a + 2] * cz) / 6;
    }
    surfaceArea = area;
    volume = Math.abs(vol);
  }

  // Bucket vertices into slices once, rather than scanning per slice.
  const band = sliceStep * 0.25;
  const slices = Math.floor(height / sliceStep);
  const buckets: P2[][] = Array.from({ length: slices + 1 }, () => []);
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1] - min[1];
    const k = Math.round(y / sliceStep);
    if (k <= slices && Math.abs(y - k * sliceStep) <= band) buckets[k].push([pos[i], pos[i + 2]]);
  }
  const profile: SliceGirth[] = buckets.map((pts, k) => ({
    height: k * sliceStep,
    loops: blobs(pts).filter((b) => b.length >= 6).map(hullPerimeter).sort((a, b) => b - a),
  }));

  const at = (frac: number) => profile[Math.min(profile.length - 1, Math.round((frac * height) / sliceStep))];
  const largest = (s: SliceGirth) => s.loops[0] ?? 0;
  // Limbs come as a pair of similar loops; take their mean.
  const limb = (s: SliceGirth) => (s.loops.length >= 2 ? (s.loops[0] + s.loops[1]) / 2 : s.loops[0] ?? 0);
  const girth = (id: string, label: string, frac: number, f: (s: SliceGirth) => number) => {
    const s = at(frac);
    return { id, label, height: s.height, value: f(s) };
  };

  return {
    height,
    width: max[2] - min[2],
    depth: max[0] - min[0],
    vertices: nv,
    surfaceArea,
    volume,
    profile,
    // Stature fractions from Drillis & Contini segment proportions.
    girths: [
      girth('neck', 'neck', 0.83, largest),
      girth('chest', 'chest', 0.72, largest),
      girth('waist', 'waist', 0.62, largest),
      girth('hip', 'hip', 0.52, largest),
      girth('thigh', 'thigh', 0.44, limb),
      girth('calf', 'calf', 0.2, limb),
      girth('ankle', 'ankle', 0.06, limb),
    ],
  };
}
