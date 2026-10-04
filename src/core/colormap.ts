/**
 * Magnitude colour ramp, for anything whose colour encodes "how much"
 * (vector magnitudes, force strips) rather than "which one".
 *
 * A diverging ramp around a near-black zero: cool to one side, warm to the
 * other, brightening with distance from the centre. The limb colours sit
 * inside it (#4697c5 ≈ --data-right, #ea5964 ≈ --data-left), so a per-side
 * magnitude runs from black (nothing) toward that side's own hue: the left
 * foot through maroon → red → blush, the right through navy → blue → mint.
 * Zero fuses with the dark chart surface, which is the point: no force, no
 * mark.
 *
 * Stops are interpolated in sRGB, as the gradient they were taken from was.
 */
import type { Side, Vec3 } from './types';

export const RAMP = [
  '#b2e3d9', // −1  mint
  '#4697c5', //     blue (≈ right limb)
  '#3056b2',
  '#312e50', //     navy
  '#201c1d', //  0  near-black
  '#532530', //     maroon
  '#aa2744',
  '#ea5964', //     red (≈ left limb)
  '#f3dada', // +1  blush
] as const;

type RGB = [number, number, number];

const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const STOPS: RGB[] = RAMP.map(toRgb);

/** Colour at t ∈ [−1, 1] across the whole ramp (clamped). Channels 0–1. */
export function diverging(t: number): RGB {
  const x = ((Math.max(-1, Math.min(1, t)) + 1) / 2) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** A side's magnitude m ∈ [0, 1]: from the black centre toward its own end. */
export const sideMagnitude = (side: Side, m: number): RGB => diverging(side === 'left' ? m : -m);

export const rgbCss = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;

/** CSS gradient of the full ramp, right side (−) to left side (+). */
export const rampCss = (direction = '90deg') =>
  `linear-gradient(${direction}, ${RAMP.map((c, i) => `${c} ${((100 * i) / (RAMP.length - 1)).toFixed(1)}%`).join(', ')})`;

/** Smallest GRF full scale, ×BW: walking peaks (~1.2) sit comfortably inside. */
export const GRF_MIN_SCALE = 1.5;

/**
 * Ground reaction force that maps to the end of the ramp (and fills the HUD
 * bars) for one trial, ×BW: the trial's peak |F| rounded up to 0.5, never
 * below GRF_MIN_SCALE. A fixed scale either saturates running (2–3 ×BW) or
 * flattens walking; per trial, both use the whole ramp. Comparing colours
 * across trials therefore needs the scale shown beside them.
 */
export function grfFullScale(foot: Record<Side, Vec3[]>): number {
  let peak = 0;
  for (const F of [foot.left, foot.right]) for (const f of F) peak = Math.max(peak, Math.hypot(f[0], f[1], f[2]));
  return Math.max(GRF_MIN_SCALE, Math.ceil(peak * 2) / 2);
}
