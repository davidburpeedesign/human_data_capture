/**
 * The data model. Every importer, whatever the file format, lands in one of
 * two shapes: a `MotionClip` (things moving over time) or a `BodyScan` (a
 * static surface). Analysis only ever sees these, never a file format.
 *
 * Lab frame convention (ISB): X anterior, Y superior, Z right. Importers are
 * responsible for rotating their source data into this frame (see
 * `analysis/frame.ts`), so nothing downstream has to ask which way is up.
 * Units are metres and seconds throughout.
 */

export type Vec3 = [number, number, number];

/** Row-major 3×3 rotation matrix, columns are the local X/Y/Z axes. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export type Side = 'left' | 'right';

/**
 * One named point tracked over time: a physical marker, or a virtual one
 * derived by an importer (a BVH joint centre, an estimated hip centre).
 * `NaN` in a component marks a gap.
 */
export interface Trajectory {
  name: string;
  /** Flat [x0, y0, z0, x1, y1, z1, ...], length = frameCount * 3. */
  data: Float32Array;
  virtual?: boolean;
}

/** A bone for drawing: pairs of trajectory names. Purely visual. */
export type Bone = [string, string];

export interface MotionClip {
  kind: 'motion';
  id: string;
  name: string;
  /** Source format, for the readout only. */
  format: 'bvh' | 'c3d' | 'csv' | 'synthetic';
  rate: number;
  frameCount: number;
  trajectories: Map<string, Trajectory>;
  bones: Bone[];
  /**
   * Canonical landmark → trajectory name. Filled by `resolveLandmarks`, so
   * analysis can ask for `R_HEEL` without knowing a lab called it `RHEE`.
   */
  landmarks: Partial<Record<LandmarkId, string>>;
  /** Treadmill belt speed (m/s), if the trial was on one. Enables stride length. */
  treadmillSpeed?: number;
  meta: Record<string, string | number>;
}

export interface BodyScan {
  kind: 'scan';
  id: string;
  name: string;
  format: 'ply' | 'obj' | 'stl';
  /** Flat vertex positions, already in the lab frame and in metres. */
  positions: Float32Array;
  /** Triangle indices, if the source was a mesh rather than a bare cloud. */
  indices: Uint32Array | null;
  colors: Float32Array | null;
  meta: Record<string, string | number>;
}

export type Dataset = MotionClip | BodyScan;

/**
 * Canonical landmarks the analysis layer understands. Side-prefixed ids are
 * generated from the base list so left and right can never drift apart.
 */
export const BASE_LANDMARKS = [
  'ASIS',   // anterior superior iliac spine
  'PSIS',   // posterior superior iliac spine
  'HJC',    // hip joint centre (virtual)
  'KNEE_LAT',
  'KNEE_MED',
  'ANKLE_LAT',
  'ANKLE_MED',
  'HEEL',
  'TOE',    // 2nd metatarsal head / toe tip
  'MT1',    // 1st metatarsal head (medial forefoot)
  'MT5',    // 5th metatarsal head (lateral forefoot)
  'SHOULDER',
  'ELBOW',
  'WRIST',
] as const;

export const CENTRAL_LANDMARKS = ['SACRUM', 'C7', 'HEAD'] as const;

type Base = (typeof BASE_LANDMARKS)[number];
export type LandmarkId = `L_${Base}` | `R_${Base}` | (typeof CENTRAL_LANDMARKS)[number];

export const sideKey = (side: Side, base: Base): LandmarkId =>
  `${side === 'left' ? 'L' : 'R'}_${base}` as LandmarkId;
