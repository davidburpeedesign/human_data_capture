/**
 * C3D importer: the biomechanics lab interchange format (Vicon, Qualisys,
 * Motion Analysis, OptiTrack all export it).
 *
 * Supports Intel (little-endian) integer and float point data, which covers
 * essentially every modern file. DEC and MIPS processor types are rejected
 * with a clear message rather than silently misread. Analog channels (force
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
  if (processor !== 1) throw new Error(`c3d: processor type ${processor} not supported (intel only)`);
  const le = true;

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
    if (prm.type === 4) return prm.bytes.getFloat32(0, le);
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
  const headerScale = view.getFloat32(12, le);
  const dataStart = (view.getUint16(16, le) - 1) * 512;
  const headerRate = view.getFloat32(20, le);

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
        x = view.getFloat32(o, le); y = view.getFloat32(o + 4, le); z = view.getFloat32(o + 8, le);
        residual = view.getFloat32(o + 12, le);
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
