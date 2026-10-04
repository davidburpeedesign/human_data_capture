/**
 * BVH importer.
 *
 * BVH gives a joint hierarchy plus per-frame Euler channels. We run forward
 * kinematics to get every joint's world position *and* orientation, then
 * emit canonical virtual markers (knee medial/lateral, heel, MT1/MT5, ...)
 * rigidly attached to the right segment. That turns a skeleton into the same
 * shape of data a marker lab produces, so a single analysis path serves both.
 *
 * Why the orientation matters: a joint centre alone cannot tell you how a
 * shank is twisted about its own axis. Tibial rotation, knee rotation and
 * foot inversion all come from the medial/lateral pairs emitted here, which
 * inherit the BVH rotation channels.
 *
 * Assumes the rest pose (all channels zero) is a neutral standing pose, as
 * mixamo, CMU and most retargeting exporters produce.
 */
import type { Bone, Mat3, MotionClip, Trajectory, Vec3 } from '../core/types';
import { IDENTITY, add, apply, cross, len, mul, norm, rotX, rotY, rotZ, scale, sub, RAD } from '../core/vec';

interface Joint {
  name: string;
  parent: number;
  offset: Vec3;
  channels: string[];
  channelStart: number;
}

export function parseBvh(text: string, name = 'clip.bvh'): MotionClip {
  const tokens = text.split(/\s+/).filter(Boolean);
  let p = 0;
  const next = () => tokens[p++];
  const joints: Joint[] = [];
  const stack: number[] = [];
  let channelCount = 0;

  if (next()?.toUpperCase() !== 'HIERARCHY') throw new Error('not a bvh file');

  while (p < tokens.length) {
    const t = next();
    const T = t.toUpperCase();
    if (T === 'ROOT' || T === 'JOINT') {
      joints.push({ name: next(), parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [], channelStart: 0 });
    } else if (T === 'END') {
      next(); // "Site"
      // End sites carry no channels; parse and discard their block.
      if (next() !== '{') throw new Error('bvh: malformed end site');
      while (next() !== '}');
    } else if (t === '{') {
      stack.push(joints.length - 1);
    } else if (t === '}') {
      stack.pop();
    } else if (T === 'OFFSET') {
      joints[joints.length - 1].offset = [+next(), +next(), +next()];
    } else if (T === 'CHANNELS') {
      const j = joints[joints.length - 1];
      const n = +next();
      j.channelStart = channelCount;
      for (let i = 0; i < n; i++) j.channels.push(next().toLowerCase());
      channelCount += n;
    } else if (T === 'MOTION') {
      break;
    }
  }

  next(); // Frames:
  const frameCount = +next();
  next(); next(); // Frame Time:
  const frameTime = +next();
  const rate = 1 / frameTime;

  const values = new Float32Array(frameCount * channelCount);
  for (let i = 0; i < values.length; i++) values[i] = +tokens[p++];

  // ── forward kinematics ───────────────────────────────────────────────
  const J = joints.length;
  const pos = joints.map(() => new Float32Array(frameCount * 3));
  const rot: Mat3[][] = joints.map(() => new Array(frameCount));

  for (let f = 0; f < frameCount; f++) {
    const base = f * channelCount;
    for (let j = 0; j < J; j++) {
      const joint = joints[j];
      let local: Mat3 = IDENTITY;
      let translation: Vec3 | null = null;
      for (let c = 0; c < joint.channels.length; c++) {
        const v = values[base + joint.channelStart + c];
        switch (joint.channels[c]) {
          case 'xposition': (translation ??= [0, 0, 0])[0] = v; break;
          case 'yposition': (translation ??= [0, 0, 0])[1] = v; break;
          case 'zposition': (translation ??= [0, 0, 0])[2] = v; break;
          // Channel order is the rotation order; compose intrinsically.
          case 'xrotation': local = mul(local, rotX(v * RAD)); break;
          case 'yrotation': local = mul(local, rotY(v * RAD)); break;
          case 'zrotation': local = mul(local, rotZ(v * RAD)); break;
        }
      }
      const offset = translation ?? joint.offset;
      let world: Vec3;
      if (joint.parent < 0) {
        world = offset;
        rot[j][f] = local;
      } else {
        const pr = rot[joint.parent][f];
        const pp = pos[joint.parent];
        world = add([pp[f * 3], pp[f * 3 + 1], pp[f * 3 + 2]], apply(pr, offset));
        rot[j][f] = mul(pr, local);
      }
      pos[j].set(world, f * 3);
    }
  }

  // Rest pose: offsets only, every rotation identity.
  const rest: Vec3[] = [];
  for (let j = 0; j < J; j++) {
    const par = joints[j].parent;
    rest[j] = par < 0 ? joints[j].offset : add(rest[par], joints[j].offset);
  }

  const trajectories = new Map<string, Trajectory>();
  joints.forEach((j, i) => trajectories.set(j.name, { name: j.name, data: pos[i] }));

  const bones: Bone[] = joints
    .filter((j) => j.parent >= 0)
    .map((j) => [joints[j.parent].name, j.name] as Bone);

  emitVirtualMarkers(joints, rest, pos, rot, frameCount, trajectories);

  return {
    kind: 'motion',
    id: `bvh-${name}-${Date.now()}`,
    name,
    format: 'bvh',
    rate,
    frameCount,
    trajectories,
    bones,
    landmarks: {},
    meta: { joints: J, channels: channelCount },
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

  return { side: null, part: clean(n) };
}

const PARTS: Record<string, string[]> = {
  hip: ['upleg', 'upperleg', 'thigh', 'femur', 'hip'],
  knee: ['leg', 'lowleg', 'lowerleg', 'knee', 'shin', 'calf', 'tibia'],
  ankle: ['foot', 'ankle'],
  toe: ['toebase', 'toe', 'toes', 'ball'],
  shoulder: ['arm', 'upperarm', 'humerus', 'shoulder'],
  elbow: ['forearm', 'lowerarm', 'elbow'],
  wrist: ['hand', 'wrist'],
};

function findJoint(joints: Joint[], side: 'L' | 'R', part: keyof typeof PARTS): number {
  const named = joints.map((j) => splitSide(j.name));
  for (const want of PARTS[part]) {
    const i = named.findIndex((n) => n.side === side && n.part === want);
    if (i >= 0) return i;
  }
  return -1;
}

function findCentral(joints: Joint[], re: RegExp): number {
  return joints.findIndex((j) => re.test(j.name.replace(/^.*:/, '')));
}

/**
 * Attach canonical markers to segments. Offsets are proportional to segment
 * lengths so the result is unit-agnostic (BVH may be cm, m or inches).
 */
function emitVirtualMarkers(
  joints: Joint[],
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
      const toeRel = sub(rest[j.toe], rest[j.ankle]);
      const footLen = Math.hypot(toeRel[0] - up[0] * dot3(toeRel, up), toeRel[1] - up[1] * dot3(toeRel, up), toeRel[2] - up[2] * dot3(toeRel, up));
      const drop = dot3(toeRel, up); // negative: toe joint below ankle
      // Heel: under the ankle at toe height, a quarter foot-length back.
      const heel = add(scale(up, drop), scale(forward, -0.25 * footLen));
      emit(`${side}_HEEL`, j.ankle, heel);
      emit(`${side}_TOE`, j.ankle, toeRel);
      emit(`${side}_MT1`, j.ankle, add(add(toeRel, scale(lateral, -0.22 * footLen)), scale(forward, -0.08 * footLen)));
      emit(`${side}_MT5`, j.ankle, add(add(toeRel, scale(lateral, 0.25 * footLen)), scale(forward, -0.18 * footLen)));
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
  emit('C7', findCentral(joints, /^neck/i), [0, 0, 0]);
  emit('HEAD', findCentral(joints, /^head$/i), [0, 0, 0]);
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
