/**
 * Landmark resolution: map whatever a lab or exporter named its markers onto
 * the canonical ids analysis asks for.
 *
 * Aliases cover Vicon Plug-in Gait / CAST-style labels, the CMU mocap
 * database's 41-marker set (waist markers LFWT/RFWT/LBWT/RBWT stand in for
 * ASIS/PSIS), Qualisys and OpenSim-ish names, and the virtual markers our
 * skeleton importers (BVH, ASF/AMC) emit.
 * Matching is case-insensitive and ignores separators and subject prefixes
 * (`Subject01:LHEE` → `lhee`). Anything unresolved simply stays unmapped:
 * each metric declares which landmarks it needs and reports itself as
 * unavailable rather than guessing.
 */
import type { LandmarkId, MotionClip, Trajectory, Vec3 } from './types';
import { BASE_LANDMARKS, CENTRAL_LANDMARKS } from './types';

type Aliases = Record<string, string[]>;

/** `{s}` expands to the side letter (l / r) and the side word (left / right). */
const SIDED: Aliases = {
  ASIS: ['{s}asi', '{s}asis', '{s}_asis', '{side}asis', '{s}ias', '{s}fwt'],
  PSIS: ['{s}psi', '{s}psis', '{side}psis', '{s}ips', '{s}bwt'],
  HJC: ['{s}hjc', '{s}hip', '{side}hip', '{side}upleg', '{s}femurhead'],
  KNEE_LAT: ['{s}kne', '{s}knee', '{s}lkn', '{s}knl', '{s}lfe', '{s}kneelat', '{side}knee', '{side}leg'],
  KNEE_MED: ['{s}kneemed', '{s}mkn', '{s}knm', '{s}kne_med', '{s}mfe', '{s}kneem'],
  ANKLE_LAT: ['{s}ank', '{s}ankle', '{s}lma', '{s}anl', '{s}ankllat', '{s}anklelat', '{side}foot', '{side}ankle'],
  ANKLE_MED: ['{s}med', '{s}mma', '{s}anm', '{s}anklemed', '{s}mmal'],
  HEEL: ['{s}hee', '{s}heel', '{s}cal', '{s}calc', '{side}heel'],
  TOE: ['{s}toe', '{s}mt2', '{s}toetip', '{side}toebase', '{side}toe', '{s}tt'],
  MT1: ['{s}mt1', '{s}fm1', '{s}met1', '{s}1mt', '{s}mh1'],
  MT5: ['{s}mt5', '{s}fm5', '{s}met5', '{s}5mt', '{s}mh5', '{s}vmh'],
  SHOULDER: ['{s}sho', '{s}shoulder', '{side}arm', '{side}shoulder', '{s}acr'],
  ELBOW: ['{s}elb', '{s}elbow', '{side}forearm', '{s}ele'],
  WRIST: ['{s}wra', '{s}wrb', '{s}wrist', '{side}hand', '{s}wri'],
};

const CENTRAL: Aliases = {
  SACRUM: ['sacr', 'sacrum', 'sac', 'hips', 'pelvis', 'root'],
  C7: ['c7', 'neck', 'clav', 'spine2', 'spine1', 'chest'],
  HEAD: ['head', 'rfhd', 'lfhd', 'headtop', 'head_end'],
};

const clean = (name: string) => name.replace(/^.*:/, '').toLowerCase().replace(/[\s_\-.]/g, '');

function expand(pattern: string, side: 'l' | 'r') {
  return clean(pattern.replace('{side}', side === 'l' ? 'left' : 'right').replace('{s}', side));
}

/** Fill `clip.landmarks` from its trajectory names. Earlier aliases win. */
export function resolveLandmarks(clip: MotionClip): MotionClip {
  const byClean = new Map<string, string>();
  for (const name of clip.trajectories.keys()) {
    const key = clean(name);
    if (!byClean.has(key)) byClean.set(key, name);
  }

  const landmarks: MotionClip['landmarks'] = {};

  for (const base of BASE_LANDMARKS) {
    for (const s of ['l', 'r'] as const) {
      const id = `${s.toUpperCase()}_${base}` as LandmarkId;
      for (const pattern of SIDED[base]) {
        const hit = byClean.get(expand(pattern, s));
        if (hit) {
          landmarks[id] = hit;
          break;
        }
      }
    }
  }

  for (const id of CENTRAL_LANDMARKS) {
    for (const alias of CENTRAL[id]) {
      const hit = byClean.get(alias);
      if (hit) {
        landmarks[id] = hit;
        break;
      }
    }
  }

  return { ...clip, landmarks };
}

/** The trajectory behind a canonical landmark, if resolved. */
export function track(clip: MotionClip, id: LandmarkId): Trajectory | undefined {
  const name = clip.landmarks[id];
  return name ? clip.trajectories.get(name) : undefined;
}

export const pointAt = (t: Trajectory, frame: number): Vec3 => [
  t.data[frame * 3],
  t.data[frame * 3 + 1],
  t.data[frame * 3 + 2],
];

/** Extract one component of a trajectory as a plain array. */
export function component(t: Trajectory, axis: 0 | 1 | 2): number[] {
  const n = t.data.length / 3;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = t.data[i * 3 + axis];
  return out;
}
