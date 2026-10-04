/**
 * ASF/AMC importer: the Acclaim skeleton + motion pair used by the CMU
 * Graphics Lab Motion Capture Database (mocap.cs.cmu.edu).
 *
 * The .asf file is the subject's skeleton (one per subject, e.g. `02.asf`);
 * each .amc file is a trial (`02_01.amc`) of per-frame joint angles for that
 * skeleton. Neither is useful alone, so the router pairs them.
 *
 * Forward kinematics, per bone, following the Acclaim spec as implemented by
 * the widely used AMCParser:
 *
 *   C        = Rz·Ry·Rx of the bone's `axis` angles (its local frame at rest)
 *   M        = Rz(rz)·Ry(ry)·Rx(rx) of the frame's dof values
 *   world    = parent.world · C · M · C⁻¹
 *   end      = start + length · world · direction
 *
 * At rest every `world` is identity, which is exactly the contract
 * `skeletonClip` needs to attach virtual markers.
 *
 * Units: ASF `:units length L` means one file unit = 1/L inches (CMU uses
 * L = 0.45). We convert to metres here. AMC carries no frame rate; CMU
 * captured at 120 Hz, which is the default.
 */
import type { Mat3, MotionClip, Vec3 } from '../core/types';
import { IDENTITY, add, apply, mul, rotX, rotY, rotZ, scale, transpose, RAD } from '../core/vec';
import { skeletonClip, type SkeletonJoint } from './skeleton';

interface AsfBone {
  name: string;
  direction: Vec3;
  length: number;   // metres
  C: Mat3;
  Cinv: Mat3;
  dof: string[];    // e.g. ['rx', 'ry', 'rz']
  parent: number;   // index into bones; -1 = root
}

export interface AsfSkeleton {
  name: string;
  /** Root channel order for AMC rows, e.g. ['tx','ty','tz','rx','ry','rz']. */
  rootOrder: string[];
  rootC: Mat3;
  rootCinv: Mat3;
  rootPosition: Vec3;
  bones: AsfBone[];
  /** Metres per file length unit. */
  unit: number;
}

const eulerXYZ = (x: number, y: number, z: number): Mat3 =>
  mul(rotZ(z * RAD), mul(rotY(y * RAD), rotX(x * RAD)));

/** Rotation from axis angles applied in the named order (`XYZ` → X first). */
function axisRotation(angles: Vec3, order = 'XYZ'): Mat3 {
  let r = IDENTITY;
  for (const ch of order.toUpperCase()) {
    const a = angles['XYZ'.indexOf(ch)] * RAD;
    const m = ch === 'X' ? rotX(a) : ch === 'Y' ? rotY(a) : rotZ(a);
    r = mul(m, r); // earlier axes apply first
  }
  return r;
}

export function parseAsf(text: string, name = 'skeleton.asf'): AsfSkeleton {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  let section = '';
  let lengthUnit = 1;
  const rootOrder: string[] = [];
  let rootAxis = 'XYZ';
  let rootPosition: Vec3 = [0, 0, 0];
  let rootOrientation: Vec3 = [0, 0, 0];
  const raw: { name: string; direction: Vec3; length: number; axis: Vec3; axisOrder: string; dof: string[] }[] = [];
  let cur: (typeof raw)[number] | null = null;
  const children = new Map<string, string[]>();

  for (const line of lines) {
    if (line.startsWith(':')) {
      section = line.split(/\s+/)[0].slice(1).toLowerCase();
      continue;
    }
    const tok = line.split(/\s+/);
    const key = tok[0].toLowerCase();

    if (section === 'units' && key === 'length') lengthUnit = +tok[1];
    else if (section === 'root') {
      if (key === 'order') rootOrder.push(...tok.slice(1).map((t) => t.toLowerCase()));
      else if (key === 'axis') rootAxis = tok[1];
      else if (key === 'position') rootPosition = [+tok[1], +tok[2], +tok[3]];
      else if (key === 'orientation') rootOrientation = [+tok[1], +tok[2], +tok[3]];
    } else if (section === 'bonedata') {
      if (key === 'begin') cur = { name: '', direction: [0, 0, 0], length: 0, axis: [0, 0, 0], axisOrder: 'XYZ', dof: [] };
      else if (key === 'end' && cur) { raw.push(cur); cur = null; }
      else if (cur) {
        if (key === 'name') cur.name = tok[1];
        else if (key === 'direction') cur.direction = [+tok[1], +tok[2], +tok[3]];
        else if (key === 'length') cur.length = +tok[1];
        else if (key === 'axis') { cur.axis = [+tok[1], +tok[2], +tok[3]]; cur.axisOrder = tok[4] ?? 'XYZ'; }
        else if (key === 'dof') cur.dof = tok.slice(1).map((t) => t.toLowerCase());
      }
    } else if (section === 'hierarchy') {
      if (key === 'begin' || key === 'end') continue;
      children.set(tok[0], [...(children.get(tok[0]) ?? []), ...tok.slice(1)]);
    }
  }

  if (!raw.length) throw new Error('asf: no bones found');

  // Inches → metres, via the file's length unit.
  const unit = 0.0254 / (lengthUnit || 1);

  // Parent links from the hierarchy; order bones so parents come first.
  const parentOf = new Map<string, string>();
  for (const [p, cs] of children) for (const c of cs) parentOf.set(c, p);
  const ordered: typeof raw = [];
  const visit = (n: string) => {
    for (const c of children.get(n) ?? []) {
      const b = raw.find((r) => r.name === c);
      if (b) { ordered.push(b); visit(c); }
    }
  };
  visit('root');
  if (ordered.length !== raw.length) throw new Error('asf: hierarchy does not reach every bone');
  const index = new Map(ordered.map((b, i) => [b.name, i]));

  const bones: AsfBone[] = ordered.map((b) => {
    const C = axisRotation(b.axis, b.axisOrder);
    const p = parentOf.get(b.name);
    return {
      name: b.name,
      direction: b.direction,
      length: b.length * unit,
      C,
      Cinv: transpose(C),
      dof: b.dof,
      parent: p && p !== 'root' ? index.get(p)! : -1,
    };
  });

  const rootC = axisRotation(rootOrientation, rootAxis);
  return {
    name,
    rootOrder: rootOrder.length ? rootOrder : ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'],
    rootC,
    rootCinv: transpose(rootC),
    rootPosition: scale(rootPosition, unit),
    bones,
    unit,
  };
}

export function parseAmc(text: string, skel: AsfSkeleton, name = 'trial.amc', rate = 120): MotionClip {
  // ── read frames ─────────────────────────────────────────────────────
  const frames: Map<string, number[]>[] = [];
  let current: Map<string, number[]> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    if (/^\d+$/.test(line)) {
      current = new Map();
      frames.push(current);
      continue;
    }
    if (!current) continue;
    const tok = line.split(/\s+/);
    current.set(tok[0], tok.slice(1).map(Number));
  }
  if (!frames.length) throw new Error('amc: no frames');

  // ── forward kinematics ──────────────────────────────────────────────
  const n = frames.length;
  const B = skel.bones.length;
  // Joint 0 is the root; joint i+1 is bone i, located at the bone's start.
  const joints: SkeletonJoint[] = [
    { name: 'root', parent: -1 },
    ...skel.bones.map((b) => ({ name: b.name, parent: b.parent + 1 })),
  ];
  const pos = joints.map(() => new Float32Array(n * 3));
  const rot: Mat3[][] = joints.map(() => new Array<Mat3>(n));
  const end: Vec3[] = new Array(B);
  const world: Mat3[] = new Array(B);

  for (let f = 0; f < n; f++) {
    const fr = frames[f];
    const rv = fr.get('root') ?? [];
    const ch = (c: string) => {
      const k = skel.rootOrder.indexOf(c);
      return k >= 0 && k < rv.length ? rv[k] : 0;
    };
    const rootPos: Vec3 = rv.length ? scale([ch('tx'), ch('ty'), ch('tz')], skel.unit) : skel.rootPosition;
    const rootRot = mul(mul(skel.rootC, eulerXYZ(ch('rx'), ch('ry'), ch('rz'))), skel.rootCinv);
    pos[0].set(rootPos, f * 3);
    rot[0][f] = rootRot;

    for (let b = 0; b < B; b++) {
      const bone = skel.bones[b];
      const v = fr.get(bone.name);
      const angle = (axis: string) => {
        const k = bone.dof.indexOf(axis);
        return v && k >= 0 ? v[k] : 0;
      };
      const parentWorld = bone.parent < 0 ? rootRot : world[bone.parent];
      const start = bone.parent < 0 ? rootPos : end[bone.parent];
      world[b] = mul(mul(mul(parentWorld, bone.C), eulerXYZ(angle('rx'), angle('ry'), angle('rz'))), bone.Cinv);
      end[b] = add(start, scale(apply(world[b], bone.direction), bone.length));
      pos[b + 1].set(start, f * 3);
      rot[b + 1][f] = world[b];
    }
  }

  // Rest pose: identity rotations, bones laid along their directions.
  const rest: Vec3[] = [skel.rootPosition];
  const restEnd: Vec3[] = [];
  skel.bones.forEach((bone, b) => {
    const start = bone.parent < 0 ? skel.rootPosition : restEnd[bone.parent];
    rest[b + 1] = start;
    restEnd[b] = add(start, scale(bone.direction, bone.length));
  });

  return skeletonClip({
    joints,
    rest,
    pos,
    rot,
    frameCount: n,
    rate,
    name,
    format: 'amc',
    meta: {
      skeleton: skel.name,
      bones: B,
      rate_assumed: rate,
      ...(kneeAxialLocked(skel) ? { knee_axial: 'locked' } : {}),
    },
  });
}

/**
 * True when neither tibia can twist about its own long axis. CMU skeletons
 * model the knee as a 1-dof hinge (`dof rx`), so knee axial rotation is
 * zero by construction there, and analysis should say so rather than
 * report a measured 0°.
 */
function kneeAxialLocked(skel: AsfSkeleton): boolean {
  const tibias = skel.bones.filter((b) => /^[lr](tibia|lowleg|lowerleg|shin)$/.test(b.name));
  if (!tibias.length) return false;
  return tibias.every((b) => {
    // The axial axis is whichever local axis the bone direction runs along.
    const local = apply(b.Cinv, b.direction).map(Math.abs);
    const axial = ['rx', 'ry', 'rz'][local.indexOf(Math.max(...local))];
    return !b.dof.includes(axial);
  });
}
