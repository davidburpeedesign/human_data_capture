/**
 * BVH importer.
 *
 * BVH gives a joint hierarchy plus per-frame Euler channels. We run forward
 * kinematics to get every joint's world position *and* orientation, then
 * emit canonical virtual markers (knee medial/lateral, heel, MT1/MT5, ...)
 * rigidly attached to the right segment. That turns a skeleton into the same
 * shape of data a marker lab produces, so a single analysis path serves both.
 *
 * The FK result goes through `skeletonClip` (shared with ASF/AMC), which
 * attaches the virtual markers.
 *
 * Why the orientation matters: a joint centre alone cannot tell you how a
 * shank is twisted about its own axis. Tibial rotation, knee rotation and
 * foot inversion all come from the medial/lateral pairs emitted here, which
 * inherit the BVH rotation channels.
 *
 * Assumes the rest pose (all channels zero) is a neutral standing pose, as
 * mixamo, CMU and most retargeting exporters produce.
 */
import type { Mat3, MotionClip, Vec3 } from '../core/types';
import { IDENTITY, add, apply, mul, rotX, rotY, rotZ, RAD } from '../core/vec';
import { skeletonClip } from './skeleton';

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

  return skeletonClip({
    joints,
    rest,
    pos,
    rot,
    frameCount,
    rate,
    name,
    format: 'bvh',
    meta: { joints: J, channels: channelCount },
  });
}
