/**
 * Skeleton → MotionClip, shared by every skeletal format (BVH, ASF/AMC).
 *
 * Input is forward-kinematics output: per joint, its world position and the
 * world rotation of the segment that starts at it, plus the rest pose. We
 * keep joint centres as drawable trajectories and attach canonical virtual
 * markers (epicondyles, malleoli, heel, MT1/MT5, ASIS/PSIS) rigidly to the
 * right segment, so skeletons and marker labs share one analysis path.
 *
 * Contract: a joint's rotation is identity in the rest pose, and the rest
 * pose is a neutral stance. BVH and ASF both satisfy this.
 */
import type { Bone, Mat3, MotionClip, Trajectory, Vec3 } from '../core/types';
import { add, apply, cross, len, norm, scale, sub } from '../core/vec';

export interface SkeletonJoint {
  name: string;
  parent: number;
}

export interface SkeletonInput {
  joints: SkeletonJoint[];
  rest: Vec3[];
  pos: Float32Array[];
  rot: Mat3[][];
  frameCount: number;
  rate: number;
  name: string;
  format: MotionClip['format'];
  meta: MotionClip['meta'];
}

export function skeletonClip(s: SkeletonInput): MotionClip {
  const trajectories = new Map<string, Trajectory>();
  s.joints.forEach((j, i) => trajectories.set(j.name, { name: j.name, data: s.pos[i] }));

  const bones: Bone[] = s.joints
    .filter((j) => j.parent >= 0)
    .map((j) => [s.joints[j.parent].name, j.name] as Bone);

  emitVirtualMarkers(s.joints, s.rest, s.pos, s.rot, s.frameCount, trajectories);

  return {
    kind: 'motion',
    id: `${s.format}-${s.name}-${Date.now()}`,
    name: s.name,
    format: s.format,
    rate: s.rate,
    frameCount: s.frameCount,
    trajectories,
    bones,
    landmarks: {},
    meta: s.meta,
  };
}

// ── joint naming ───────────────────────────────────────────────────────────

function splitSide(raw: string): { side: 'L' | 'R' | null; part: string } {
  const n = raw.replace(/^.*:/, '');
  const clean = (s: string) => s.toLowerCase().replace(/[_\-\s.]/g, '');
  const toSide = (s: string) => (s[0].toUpperCase() === 'L' ? 'L' : 'R');

  const prefix =
    n.match(/^(Left|Right)(.*)$/i) ??
    n.match(/^([LR])[_\-\s.](.*)$/i) ??
    n.match(/^([LR])(?=[A-Z])(.*)$/);
  if (prefix) return { side: toSide(prefix[1]), part: clean(prefix[2]) };

  const suffix = n.match(/^(.*?)[_\-\s.]?(Left|Right)$/i) ?? n.match(/^(.*?)[_\-\s.]([LR])$/i);
  if (suffix) return { side: toSide(suffix[2]), part: clean(suffix[1]) };

  // CMU ASF style: all-lowercase with a bare side letter (lfemur, rtibia).
  // Only trusted when the remainder is a known body part, so `lowerback`
  // is not read as a left "owerback".
  const cmu = n.match(/^([lr])([a-z]+)$/);
  if (cmu && KNOWN_PARTS.has(cmu[2])) return { side: toSide(cmu[1]), part: cmu[2] };

  return { side: null, part: clean(n) };
}

/** Segment names by convention, earliest wins (mixamo/CMU BVH, ASF, generic). */
const PARTS: Record<string, string[]> = {
  hip: ['upleg', 'upperleg', 'thigh', 'femur', 'hip'],
  knee: ['leg', 'lowleg', 'lowerleg', 'knee', 'shin', 'calf', 'tibia'],
  ankle: ['foot', 'ankle'],
  toe: ['toebase', 'toe', 'toes', 'ball'],
  shoulder: ['arm', 'upperarm', 'humerus', 'shoulder'],
  elbow: ['forearm', 'lowerarm', 'radius', 'elbow'],
  wrist: ['wrist', 'hand'],
};

// Every part name above plus the CMU-only segments that carry a side letter.
const KNOWN_PARTS = new Set([
  ...Object.values(PARTS).flat(),
  'hipjoint', 'clavicle', 'fingers', 'thumb',
]);

function findJoint(joints: SkeletonJoint[], side: 'L' | 'R', part: keyof typeof PARTS): number {
  const named = joints.map((j) => splitSide(j.name));
  for (const want of PARTS[part]) {
    const i = named.findIndex((n) => n.side === side && n.part === want);
    if (i >= 0) return i;
  }
  return -1;
}

function findCentral(joints: SkeletonJoint[], re: RegExp): number {
  return joints.findIndex((j) => re.test(j.name.replace(/^.*:/, '')));
}

/**
 * Attach canonical markers to segments. Offsets are proportional to segment
 * lengths so the result is unit-agnostic (BVH may be cm, m or inches).
 */
function emitVirtualMarkers(
  joints: SkeletonJoint[],
  rest: Vec3[],
  pos: Float32Array[],
  rot: Mat3[][],
  frameCount: number,
  out: Map<string, Trajectory>,
) {
  const idx = {
    L: { hip: findJoint(joints, 'L', 'hip'), knee: findJoint(joints, 'L', 'knee'), ankle: findJoint(joints, 'L', 'ankle'), toe: findJoint(joints, 'L', 'toe') },
    R: { hip: findJoint(joints, 'R', 'hip'), knee: findJoint(joints, 'R', 'knee'), ankle: findJoint(joints, 'R', 'ankle'), toe: findJoint(joints, 'R', 'toe') },
  };
  if (idx.L.hip < 0 || idx.R.hip < 0) return;

  const right = norm(sub(rest[idx.R.hip], rest[idx.L.hip]));
  const legMid = scale(add(rest[idx.L.hip], rest[idx.R.hip]), 0.5);
  const ankleMid = idx.L.ankle >= 0 && idx.R.ankle >= 0
    ? scale(add(rest[idx.L.ankle], rest[idx.R.ankle]), 0.5)
    : sub(legMid, [0, 1, 0]);
  const up = norm(sub(legMid, ankleMid));
  const forward = norm(cross(up, right));
  const pelvisWidth = len(sub(rest[idx.R.hip], rest[idx.L.hip]));

  const emit = (name: string, joint: number, restOffset: Vec3) => {
    if (joint < 0) return;
    const data = new Float32Array(frameCount * 3);
    const jp = pos[joint];
    for (let f = 0; f < frameCount; f++) {
      const o = apply(rot[joint][f], restOffset);
      data[f * 3] = jp[f * 3] + o[0];
      data[f * 3 + 1] = jp[f * 3 + 1] + o[1];
      data[f * 3 + 2] = jp[f * 3 + 2] + o[2];
    }
    out.set(name, { name, data, virtual: true });
  };

  for (const side of ['L', 'R'] as const) {
    const j = idx[side];
    const lateral = scale(right, side === 'R' ? 1 : -1);
    const thighLen = j.knee >= 0 ? len(sub(rest[j.knee], rest[j.hip])) : pelvisWidth * 2.5;

    emit(`${side}_HJC`, j.hip, [0, 0, 0]);

    // Epicondyles ride the thigh (hip joint's rotation), malleoli the shank.
    const kw = 0.05 * thighLen;
    emit(`${side}_KNEE_LAT`, j.hip, add(sub(rest[j.knee], rest[j.hip]), scale(lateral, kw)));
    emit(`${side}_KNEE_MED`, j.hip, add(sub(rest[j.knee], rest[j.hip]), scale(lateral, -kw)));
    if (j.ankle >= 0 && j.knee >= 0) {
      const aw = 0.035 * thighLen;
      emit(`${side}_ANKLE_LAT`, j.knee, add(sub(rest[j.ankle], rest[j.knee]), scale(lateral, aw)));
      emit(`${side}_ANKLE_MED`, j.knee, add(sub(rest[j.ankle], rest[j.knee]), scale(lateral, -aw)));
    }

    if (j.ankle >= 0 && j.toe >= 0) {
      // Build the foot in the shank's frame, not the world's: rest pose is
      // the neutral the analysis zeroes against, and some rigs (CMU ASF)
      // stand with legs splayed ~20°. A world-level foot under a splayed
      // tibia would read as 20° of inversion once the leg comes vertical.
      const legUp = j.knee >= 0 ? norm(sub(rest[j.knee], rest[j.ankle])) : up;
      const footRight = norm(sub(right, scale(legUp, dot3(right, legUp))));
      const footFwd = norm(cross(legUp, footRight));
      const footLat = scale(footRight, side === 'R' ? 1 : -1);
      const toeRel = sub(rest[j.toe], rest[j.ankle]);
      const drop = dot3(toeRel, legUp); // negative: toe joint below ankle
      const footLen = len(sub(toeRel, scale(legUp, drop)));
      // Heel: below the ankle at toe level, a quarter foot-length back.
      const heel = add(scale(legUp, drop), scale(footFwd, -0.25 * footLen));
      emit(`${side}_HEEL`, j.ankle, heel);
      emit(`${side}_TOE`, j.ankle, toeRel);
      emit(`${side}_MT1`, j.ankle, add(add(toeRel, scale(footLat, -0.22 * footLen)), scale(footFwd, -0.08 * footLen)));
      emit(`${side}_MT5`, j.ankle, add(add(toeRel, scale(footLat, 0.25 * footLen)), scale(footFwd, -0.18 * footLen)));
    }

    for (const part of ['shoulder', 'elbow', 'wrist'] as const) {
      emit(`${side}_${part.toUpperCase()}`, findJoint(joints, side, part), [0, 0, 0]);
    }
  }

  // Pelvis landmarks ride the root. Proportions from pelvis width.
  const root = joints.findIndex((j) => j.parent < 0);
  const rootToMid = sub(legMid, rest[root]);
  for (const side of ['L', 'R'] as const) {
    const lateral = scale(right, side === 'R' ? 1 : -1);
    emit(`${side}_ASIS`, root, add(rootToMid, add(add(scale(forward, 0.28 * pelvisWidth), scale(up, 0.3 * pelvisWidth)), scale(lateral, 0.65 * pelvisWidth))));
    emit(`${side}_PSIS`, root, add(rootToMid, add(add(scale(forward, -0.45 * pelvisWidth), scale(up, 0.38 * pelvisWidth)), scale(lateral, 0.22 * pelvisWidth))));
  }
  emit('SACRUM', root, add(rootToMid, add(scale(forward, -0.5 * pelvisWidth), scale(up, 0.3 * pelvisWidth))));
  emit('C7', findCentral(joints, /^(neck|lowerneck)/i), [0, 0, 0]);
  emit('HEAD', findCentral(joints, /^head$/i), [0, 0, 0]);
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
