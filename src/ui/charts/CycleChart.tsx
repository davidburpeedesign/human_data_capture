/**
 * Gait-cycle chart: mean ± 1 sd per limb over 0–100 % of the cycle, with
 * a toe-off divider and a crosshair tooltip on hover.
 *
 * Canvas, not SVG, because a dozen of these redraw on every playback frame.
 * Grid and axes are recessive bone hairlines; only data marks carry colour,
 * and text never wears the series colour.
 *
 * Each mean line is shaded by its value on the magnitude ramp, the same
 * scheme as the GRF arrows and force strips: dim near the low end, toward
 * the limb's own hue and past it at the high end. Left stays warm and right
 * cool, so the limbs are still told apart by hue.
 */
import { useEffect, useRef, useState } from 'react';
import type { Curve } from '../../analysis/report';
import { rgbCss, sideMagnitude } from '../../core/colormap';

interface Props {
  curve: Curve;
  /** Current position in each limb's cycle, %, for the playhead ticks. */
  cursor?: { left?: number; right?: number };
  toeOff?: number;
  height?: number;
  /**
   * For quantities with a true zero (force, ×BW): shade by |v| over the
   * chart's largest |v|, so zero is darkest. Otherwise the line is shaded
   * over the chart's own range, low to high, since a joint angle's zero is
   * a convention, not "none". Either way each chart uses the whole ramp: a
   * scale shared across charts left the small fore-aft and mediolateral
   * forces in one dark shade.
   */
  zeroBased?: boolean;
}

/**
 * Lowest ramp position a line is drawn at: the ramp's true zero is near-black
 * and would vanish into the plot surface, so a curve keeps a visible floor.
 */
const LINE_FLOOR = 0.3;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

const PAD = { l: 34, r: 8, t: 8, b: 18 };

/** Inclusive [start, end] index runs of finite values. */
function runs(v: number[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  v.forEach((x, i) => {
    if (Number.isFinite(x)) { if (start < 0) start = i; }
    else if (start >= 0) { out.push([start, i - 1]); start = -1; }
  });
  if (start >= 0) out.push([start, v.length - 1]);
  return out;
}

export function CycleChart({ curve, cursor, toeOff, height = 132, zeroBased }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const series = (['left', 'right'] as const).filter((s) => curve[s]);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) {
    const { mean, sd } = curve[s]!;
    mean.forEach((m, i) => {
      if (!Number.isFinite(m)) return; // not covered (stride cut off by trial end)
      lo = Math.min(lo, m - sd[i]); hi = Math.max(hi, m + sd[i]);
    });
  }
  // Range of the means alone (not the sd band), for value shading.
  let vLo = Infinity, vHi = -Infinity;
  for (const s of series) for (const m of curve[s]!.mean) if (Number.isFinite(m)) { vLo = Math.min(vLo, m); vHi = Math.max(vHi, m); }
  const vAbs = Math.max(Math.abs(vLo), Math.abs(vHi));
  const shade = (v: number) => {
    const t = zeroBased ? Math.abs(v) / (vAbs || 1) : (v - vLo) / (vHi - vLo || 1);
    return LINE_FLOOR + (1 - LINE_FLOOR) * Math.max(0, Math.min(1, t));
  };
  const padY = (hi - lo) * 0.08 || 1;
  lo -= padY; hi += padY;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const X = (pct: number) => PAD.l + (pct / 100) * pw;
    const Y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ph;

    ctx.font = `10px ${css('--font-mono')}`;
    ctx.lineWidth = 1;

    // Grid + axis labels.
    for (const v of niceTicks(lo, hi)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? css('--mx-bone-24') : css('--line-soft');
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillStyle = css('--text-faint');
      ctx.textAlign = 'right';
      ctx.fillText(String(v), PAD.l - 5, y + 3);
    }
    ctx.textAlign = 'center';
    for (const pct of [0, 25, 50, 75, 100]) {
      const x = Math.round(X(pct)) + 0.5;
      ctx.strokeStyle = css('--line-soft');
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.fillStyle = css('--text-faint');
      ctx.fillText(`${pct}`, x, h - 5);
    }

    if (toeOff !== undefined && Number.isFinite(toeOff)) {
      const x = Math.round(X(toeOff)) + 0.5;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = css('--mx-bone-40');
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css('--text-faint');
      ctx.textAlign = 'left';
      ctx.fillText('to', x + 3, PAD.t + 9);
    }

    // Playhead: a faint full-height line per limb at its current cycle
    // position, behind the data, so the dot on the curve is easy to find.
    for (const s of series) {
      const cur = cursor?.[s];
      if (cur === undefined) continue;
      const x = Math.round(X(cur)) + 0.5;
      ctx.strokeStyle = css(s === 'left' ? '--data-left' : '--data-right');
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const s of series) {
      const { mean, sd } = curve[s]!;
      const color = css(s === 'left' ? '--data-left' : '--data-right');
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.14;
      // Band and line over each covered run only: a partial stride stops
      // where the trial did, rather than dropping to zero or bridging a gap.
      for (const [a, b] of runs(mean)) {
        ctx.beginPath();
        for (let i = a; i <= b; i++) ctx.lineTo(X(i), Y(mean[i] + sd[i]));
        for (let i = b; i >= a; i--) ctx.lineTo(X(i), Y(mean[i] - sd[i]));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // x is monotonic in the sample index, so a horizontal gradient with a
      // stop per sample shades the whole line by value in one stroke.
      const grad = ctx.createLinearGradient(X(0), 0, X(mean.length - 1), 0);
      mean.forEach((m, i) => {
        if (Number.isFinite(m)) grad.addColorStop(i / (mean.length - 1), rgbCss(sideMagnitude(s, shade(m))));
      });
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of runs(mean)) {
        ctx.moveTo(X(a), Y(mean[a]));
        for (let i = a + 1; i <= b; i++) ctx.lineTo(X(i), Y(mean[i]));
      }
      ctx.stroke();
      ctx.lineWidth = 1;

      const cur = cursor?.[s];
      if (cur !== undefined && Number.isFinite(mean[Math.round(cur)])) {
        const i = Math.round(cur);
        ctx.fillStyle = rgbCss(sideMagnitude(s, shade(mean[i])));
        ctx.strokeStyle = css('--bg-deep');
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(i), Y(mean[i]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    if (hover !== null) {
      const x = Math.round(X(hover)) + 0.5;
      ctx.strokeStyle = css('--mx-bone-55');
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + ph); ctx.stroke();
    }
  });

  const onMove = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const pct = ((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * 100;
    setHover(pct < 0 || pct > 100 ? null : Math.round(pct));
    setHoverX(e.clientX - r.left);
  };

  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span>{curve.label}</span>
        <span className="muted">
          {curve.unit}
          {curve.status === 'proxy' && <em className="tag tag--proxy">proxy</em>}
        </span>
      </figcaption>
      {curve.status === 'unavailable' ? (
        <div className="chart__na muted">not available: required landmarks missing</div>
      ) : (
        <div className="chart__plot" style={{ height }}>
          <canvas ref={canvas} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          {hover !== null && (
            <div className="chart__tip" style={hoverX > 160 ? { right: `calc(100% - ${hoverX - 8}px)` } : { left: hoverX + 8 }}>
              <span className="muted">{hover}% cycle</span>
              {series.map((s) => (
                <span key={s}>
                  <i style={{ background: `var(--data-${s})` }} />
                  {s[0]} {fmt(curve[s]!.mean[hover])} ± {fmt(curve[s]!.sd[hover])}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
