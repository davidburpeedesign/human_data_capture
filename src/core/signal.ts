/**
 * 1-D signal tools for kinematic time series: gap filling, zero-lag
 * low-pass filtering, differentiation, extrema and resampling.
 *
 * Everything takes and returns plain number arrays. Trajectories are
 * filtered per component before any derived quantity (angle, velocity) is
 * computed, because differentiating raw marker noise amplifies it by the
 * sample rate.
 */

/** Linear interpolation across NaN gaps; edges are held at the nearest value. */
export function fillGaps(x: ArrayLike<number>): number[] {
  const out = Array.from(x);
  const n = out.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (last === -1 && i > 0) for (let j = 0; j < i; j++) out[j] = out[i];
    else if (last >= 0 && i - last > 1) {
      for (let j = last + 1; j < i; j++) out[j] = out[last] + ((out[i] - out[last]) * (j - last)) / (i - last);
    }
    last = i;
  }
  if (last >= 0) for (let j = last + 1; j < n; j++) out[j] = out[last];
  return out;
}

/**
 * 2nd-order Butterworth low-pass run forward then backward (filtfilt), so
 * the result has zero phase lag. That matters: a lagged heel trajectory
 * shifts every gait event late by a few frames.
 *
 * The effective order is 4 after the double pass, and the cutoff is
 * corrected for that (Winter, 2009) so `cutoff` is the true -3 dB point.
 * 6 Hz is the usual choice for walking marker data.
 */
export function lowpass(x: ArrayLike<number>, rate: number, cutoff = 6): number[] {
  const data = fillGaps(x);
  if (data.length < 12 || cutoff >= rate / 2) return data;

  const correction = 1 / Math.pow(Math.SQRT2 - 1, 0.25); // ≈1.247 for two passes
  const wc = Math.tan((Math.PI * cutoff * correction) / rate);
  const k1 = Math.SQRT2 * wc;
  const k2 = wc * wc;
  const a0 = k2 / (1 + k1 + k2);
  const a1 = 2 * a0;
  const a2 = a0;
  const b1 = (2 * (1 - k2)) / (1 + k1 + k2);
  const b2 = (-1 + k1 - k2) / (1 + k1 + k2);

  const pass = (s: number[]) => {
    // Pad by reflection so the filter's start-up transient lands in padding.
    const pad = Math.min(30, s.length - 1);
    const padded = [
      ...s.slice(1, pad + 1).reverse().map((v) => 2 * s[0] - v),
      ...s,
      ...s.slice(-pad - 1, -1).reverse().map((v) => 2 * s[s.length - 1] - v),
    ];
    const y = new Array<number>(padded.length);
    y[0] = padded[0];
    y[1] = padded[1];
    for (let i = 2; i < padded.length; i++) {
      y[i] = a0 * padded[i] + a1 * padded[i - 1] + a2 * padded[i - 2] + b1 * y[i - 1] + b2 * y[i - 2];
    }
    return y.slice(pad, pad + s.length);
  };

  return pass(pass(data).reverse()).reverse();
}

/** Central-difference derivative, per second. */
export function derivative(x: ArrayLike<number>, rate: number): number[] {
  const n = x.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  out[0] = (x[1] - x[0]) * rate;
  out[n - 1] = (x[n - 1] - x[n - 2]) * rate;
  for (let i = 1; i < n - 1; i++) out[i] = ((x[i + 1] - x[i - 1]) * rate) / 2;
  return out;
}

/**
 * Indices of local maxima at least `minDistance` samples apart. When two
 * peaks compete inside that window the taller one wins, which is what
 * suppresses the double-bump a heel marker can show at contact.
 */
export function findPeaks(x: ArrayLike<number>, minDistance: number, minProminence = 0): number[] {
  const n = x.length;
  const candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (x[i] > x[i - 1] && x[i] >= x[i + 1]) candidates.push(i);
  }
  candidates.sort((a, b) => x[b] - x[a]);
  const taken = new Uint8Array(n);
  const peaks: number[] = [];
  for (const i of candidates) {
    if (taken[i]) continue;
    if (minProminence > 0) {
      // Prominence over the window: drop to the *higher* of the two side
      // minima, so a shoulder on a slope doesn't count as a peak.
      let loL = x[i], loR = x[i];
      for (let j = Math.max(0, i - minDistance); j < i; j++) loL = Math.min(loL, x[j]);
      for (let j = i + 1; j < Math.min(n, i + minDistance); j++) loR = Math.min(loR, x[j]);
      if (x[i] - Math.max(loL, loR) < minProminence) continue;
    }
    peaks.push(i);
    for (let j = Math.max(0, i - minDistance + 1); j < Math.min(n, i + minDistance); j++) taken[j] = 1;
  }
  return peaks.sort((a, b) => a - b);
}

/** Linear resample of x[start..end] to `points` samples (101 → 0..100 % cycle). */
export function resample(x: ArrayLike<number>, start: number, end: number, points = 101): number[] {
  const out = new Array<number>(points);
  const span = end - start;
  for (let i = 0; i < points; i++) {
    const t = start + (span * i) / (points - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(i0 + 1, x.length - 1);
    const f = t - i0;
    out[i] = x[i0] * (1 - f) + x[i1] * f;
  }
  return out;
}

export const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);

export function std(x: number[]) {
  if (x.length < 2) return NaN;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
}

/** Coefficient of variation, percent. The standard gait-variability figure. */
export const cv = (x: number[]) => (100 * std(x)) / Math.abs(mean(x));

export const range = (x: number[]) => (x.length ? Math.max(...x) - Math.min(...x) : NaN);

/** Point-wise mean ± sd across equal-length curves (cycle-normalised data). */
export function ensemble(curves: number[][]): { mean: number[]; sd: number[] } {
  if (!curves.length) return { mean: [], sd: [] };
  const n = curves[0].length;
  const m = new Array<number>(n);
  const s = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const col = curves.map((c) => c[i]);
    m[i] = mean(col);
    s[i] = curves.length > 1 ? std(col) : 0;
  }
  return { mean: m, sd: s };
}
