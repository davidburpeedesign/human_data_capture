/**
 * Analysis context: filtered, gap-filled landmark positions, computed once
 * per clip and shared by every metric. Filtering happens here and only here
 * so that two metrics can never disagree because one forgot to smooth.
 */
import type { LandmarkId, MotionClip, Side, Vec3 } from '../core/types';
import { sideKey } from '../core/types';
import { track } from '../core/landmarks';
import { lowpass } from '../core/signal';

export interface AnalysisOptions {
  /** Low-pass cutoff for marker positions, Hz. 6 Hz walking, ~10–12 Hz running. */
  cutoff: number;
  /** Treadmill belt speed, m/s. Overrides auto-detection when set. */
  treadmillSpeed?: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = { cutoff: 6 };

export interface Ctx {
  clip: MotionClip;
  rate: number;
  n: number;
  opts: AnalysisOptions;
  /** Filtered positions for a landmark, or null if it is not in the clip. */
  p(id: LandmarkId): Vec3[] | null;
  /** `p` for a side-prefixed landmark. */
  ps(side: Side, base: Parameters<typeof sideKey>[1]): Vec3[] | null;
}

export function createContext(clip: MotionClip, opts: Partial<AnalysisOptions> = {}): Ctx {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const cache = new Map<LandmarkId, Vec3[] | null>();
  const rate = clip.rate;
  const n = clip.frameCount;

  const p = (id: LandmarkId) => {
    if (cache.has(id)) return cache.get(id)!;
    const t = track(clip, id);
    let out: Vec3[] | null = null;
    if (t) {
      const axes = [0, 1, 2].map((a) => {
        const raw = new Array<number>(n);
        for (let i = 0; i < n; i++) raw[i] = t.data[i * 3 + a];
        return lowpass(raw, rate, options.cutoff);
      });
      out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = [axes[0][i], axes[1][i], axes[2][i]];
      if (!Number.isFinite(out[0][0])) out = null; // fully empty trajectory
    }
    cache.set(id, out);
    return out;
  };

  return { clip, rate, n, opts: options, p, ps: (side, base) => p(sideKey(side, base)) };
}
