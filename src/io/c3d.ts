/**
 * C3D importer: the biomechanics lab interchange format (Vicon, Qualisys,
 * Motion Analysis, OptiTrack all export it).
 *
 * Supports integer and float point data from all three C3D processor types:
 * Intel (little-endian), DEC (VAX floats; many CMU database files) and MIPS
 * (big-endian). Analog channels (force
 * plates, EMG) are skipped for now; see ARCHITECTURE.md §roadmap.
 *
 * Reference: https://www.c3d.org/HTML/default.htm
 */
import type { MotionClip, Trajectory } from '../core/types';

interface Param {
  type: number;
  dims: number[];
  bytes: DataView;
}

export function parseC3d(buffer: ArrayBuffer, name = 'trial.c3d'): MotionClip {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  if (u8[1] !== 0x50) throw new Error('not a c3d file');

  const paramBlock = u8[0];
  const paramStart = (paramBlock - 1) * 512;
  const processor = u8[paramStart + 3] - 83; // 1 intel, 2 dec, 3 mips
  if (processor < 1 || processor > 3) throw new Error(`c3d: unknown processor type ${processor}`);
  // DEC shares Intel's little-endian integers; only MIPS is big-endian.
  const le = processor !== 3;
  const f32 = (offset: number) => (processor === 2 ? decFloat(u8, offset) : view.getFloat32(offset, le));

  // ── parameter section ────────────────────────────────────────────────
  const groups = new Map<number, string>();
  const params = new Map<string, Param>();
  let p = paramStart + 4;
  for (;;) {
    const nameLen = view.getInt8(p);
    const id = view.getInt8(p + 1);
    if (nameLen === 0) break;
    const label = String.fromCharCode(...u8.subarray(p + 2, p + 2 + Math.abs(nameLen))).toUpperCase();
    const offsetPos = p + 2 + Math.abs(nameLen);
    const nextOffset = view.getInt16(offsetPos, le);
    let q = offsetPos + 2;
    if (id < 0) {
      groups.set(-id, label);
    } else {
      const type = view.getInt8(q);
      const nd = view.getUint8(q + 1);
      const dims: number[] = [];
      for (let i = 0; i < nd; i++) dims.push(view.getUint8(q + 2 + i));
      q += 2 + nd;
      const count = dims.reduce((a, b) => a * b, 1);
      const size = Math.abs(type) * count;
      params.set(`${id}:${label}`, { type, dims, bytes: new DataView(buffer, q, size) });
    }
    if (nextOffset === 0) break;
    p = offsetPos + nextOffset;
  }

  const get = (group: string, param: string): Param | undefined => {
    for (const [gid, gname] of groups) {
      if (gname === group) {
        const hit = params.get(`${gid}:${param}`);
        if (hit) return hit;
      }
    }
    return undefined;
  };

  const num = (prm: Param | undefined, fallback: number) => {
    if (!prm) return fallback;
    if (prm.type === 4) return f32(prm.bytes.byteOffset);
    if (prm.type === 2) return prm.bytes.getInt16(0, le);
    return prm.bytes.getInt8(0);
  };

  const strings = (prm: Param | undefined): string[] => {
    if (!prm || prm.type !== -1) return [];
    const [w, n = 1] = prm.dims;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      let s = '';
      for (let j = 0; j < w; j++) s += String.fromCharCode(prm.bytes.getUint8(i * w + j));
      out.push(s.trim());
    }
    return out;
  };

  // ── header ───────────────────────────────────────────────────────────
  const pointCount = view.getUint16(2, le);
  const analogPerFrame = view.getUint16(4, le);
  const firstFrame = view.getUint16(6, le);
  const lastFrame = view.getUint16(8, le);
  const headerScale = f32(12);
  const dataStart = (view.getUint16(16, le) - 1) * 512;
  const headerRate = f32(20);

  const scaleFactor = num(get('POINT', 'SCALE'), headerScale);
  const rate = num(get('POINT', 'RATE'), headerRate);
  // POINT:FRAMES may be stored as float in long trials; header is the reliable count.
  const frameCount = lastFrame - firstFrame + 1;
  const units = strings(get('POINT', 'UNITS'))[0]?.toLowerCase() ?? 'mm';
  const labels = [
    ...strings(get('POINT', 'LABELS')),
    ...strings(get('POINT', 'LABELS2')),
  ];

  const isFloat = scaleFactor < 0;
  const ptBytes = isFloat ? 16 : 8;
  const analogBytes = isFloat ? 4 : 2;
  const frameBytes = pointCount * ptBytes + analogPerFrame * analogBytes;
  const unit = units === 'm' ? 1 : units === 'cm' ? 0.01 : 0.001;
  const s = Math.abs(scaleFactor);

  const data = Array.from({ length: pointCount }, () => new Float32Array(frameCount * 3));
  for (let f = 0; f < frameCount; f++) {
    const base = dataStart + f * frameBytes;
    for (let i = 0; i < pointCount; i++) {
      const o = base + i * ptBytes;
      let x, y, z, residual;
      if (isFloat) {
        x = f32(o); y = f32(o + 4); z = f32(o + 8);
        residual = f32(o + 12);
      } else {
        x = view.getInt16(o, le) * s; y = view.getInt16(o + 2, le) * s; z = view.getInt16(o + 4, le) * s;
        residual = view.getInt16(o + 6, le);
      }
      // A negative residual marks an invalid (occluded) sample.
      const valid = residual >= 0;
      data[i][f * 3] = valid ? x * unit : NaN;
      data[i][f * 3 + 1] = valid ? y * unit : NaN;
      data[i][f * 3 + 2] = valid ? z * unit : NaN;
    }
  }

  const trajectories = new Map<string, Trajectory>();
  for (let i = 0; i < pointCount; i++) {
    const label = labels[i] || `pt${i + 1}`;
    if (!trajectories.has(label)) trajectories.set(label, { name: label, data: data[i] });
  }

  return {
    kind: 'motion',
    id: `c3d-${name}-${Date.now()}`,
    name,
    format: 'c3d',
    rate,
    frameCount,
    trajectories,
    bones: [],
    landmarks: {},
    meta: { points: pointCount, analog_per_frame: analogPerFrame, units },
  };
}

/**
 * VAX F_floating → IEEE single. Same field widths as IEEE, but the two
 * 16-bit words are swapped and the exponent bias is 128 with the hidden bit
 * at 0.1 instead of 1.0, which together make the value 4× too large.
 */
const decScratch = new DataView(new ArrayBuffer(4));
function decFloat(u8: Uint8Array, o: number): number {
  decScratch.setUint8(0, u8[o + 2]);
  decScratch.setUint8(1, u8[o + 3]);
  decScratch.setUint8(2, u8[o]);
  decScratch.setUint8(3, u8[o + 1]);
  return decScratch.getFloat32(0, true) / 4;
}
