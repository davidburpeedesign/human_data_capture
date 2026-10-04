/**
 * Gait-cycle chart: mean ± 1 sd per limb over 0–100 % of the cycle, with
 * a toe-off divider and a crosshair tooltip on hover.
 *
 * Canvas, not SVG, because a dozen of these redraw on every playback frame.
 * Grid and axes are recessive bone hairlines; only data marks carry colour,
 * and text never wears the series colour.
 */
import { useEffect, useRef, useState } from 'react';
import type { Curve } from '../../analysis/report';

interface Props {
  curve: Curve;
  /** Current position in each limb's cycle, %, for the playhead ticks. */
  cursor?: { left?: number; right?: number };
  toeOff?: number;
  height?: number;
}

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

export function CycleChart({ curve, cursor, toeOff, height = 132 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const series = (['left', 'right'] as const).filter((s) => curve[s]);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) {
    const { mean, sd } = curve[s]!;
    mean.forEach((m, i) => { lo = Math.min(lo, m - sd[i]); hi = Math.max(hi, m + sd[i]); });
  }
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

    for (const s of series) {
      const { mean, sd } = curve[s]!;
      const color = css(s === 'left' ? '--data-left' : '--data-right');
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      mean.forEach((m, i) => ctx.lineTo(X(i), Y(m + sd[i])));
      for (let i = mean.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(mean[i] - sd[i]));
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      mean.forEach((m, i) => (i ? ctx.lineTo(X(i), Y(m)) : ctx.moveTo(X(i), Y(m))));
      ctx.stroke();
      ctx.lineWidth = 1;

      const cur = cursor?.[s];
      if (cur !== undefined) {
        const i = Math.round(cur);
        ctx.fillStyle = color;
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

  const fmt = (v: number) => v.toFixed(1);

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
