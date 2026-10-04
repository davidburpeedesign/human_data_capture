/**
 * Scan readout: overall dimensions, mesh measures and the girth profile.
 * The profile is drawn standing up (height on y) so it reads against the
 * body in the viewport.
 */
import { useEffect, useRef } from 'react';
import type { BodyScan } from '../core/types';
import type { ScanReport } from '../analysis/scan';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function ScanPanel({ report, scan }: { report: ScanReport; scan: BodyScan }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 34, r: 12, t: 8, b: 18 };
    const maxG = Math.max(0.2, ...report.profile.map((s) => s.loops[0] ?? 0));
    const X = (g: number) => pad.l + (g / maxG) * (w - pad.l - pad.r);
    const Y = (y: number) => h - pad.b - (y / report.height) * (h - pad.t - pad.b);

    ctx.font = `10px ${css('--font-mono')}`;
    ctx.lineWidth = 1;
    for (let y = 0; y <= report.height; y += 0.25) {
      ctx.strokeStyle = css('--line-soft');
      ctx.beginPath(); ctx.moveTo(pad.l, Math.round(Y(y)) + 0.5); ctx.lineTo(w - pad.r, Math.round(Y(y)) + 0.5); ctx.stroke();
      ctx.fillStyle = css('--text-faint');
      ctx.textAlign = 'right';
      ctx.fillText(y.toFixed(2), pad.l - 5, Y(y) + 3);
    }
    ctx.textAlign = 'center';
    for (let g = 0; g <= maxG; g += 0.25) {
      ctx.fillText(`${(g * 100).toFixed(0)}`, X(g), h - 5);
    }

    // Each loop rank as its own trace: torso (largest), then limbs.
    const ranks = [0, 1];
    ranks.forEach((k) => {
      ctx.strokeStyle = k === 0 ? css('--mx-bone') : css('--mx-bone-40');
      ctx.lineWidth = k === 0 ? 2 : 1;
      ctx.beginPath();
      let pen = false;
      for (const s of report.profile) {
        const v = s.loops[k];
        if (v === undefined) { pen = false; continue; }
        if (pen) ctx.lineTo(X(v), Y(s.height)); else ctx.moveTo(X(v), Y(s.height));
        pen = true;
      }
      ctx.stroke();
    });

    // Named girths: coral indicator marks.
    ctx.fillStyle = css('--accent');
    for (const g of report.girths) {
      if (!g.value) continue;
      ctx.fillRect(X(g.value) - 3, Y(g.height) - 1, 6, 2);
    }
  }, [report]);

  const cm = (m: number) => `${(m * 100).toFixed(1)}`;

  return (
    <div className="scanpanel">
      <table className="mtable">
        <thead><tr><th className="mtable__group">dimensions</th><th /><th /></tr></thead>
        <tbody>
          <tr className="mrow"><td className="mrow__label">stature</td><td className="num">{cm(report.height)}</td><td className="mrow__unit">cm</td></tr>
          <tr className="mrow"><td className="mrow__label">width (ml)</td><td className="num">{cm(report.width)}</td><td className="mrow__unit">cm</td></tr>
          <tr className="mrow"><td className="mrow__label">depth (ap)</td><td className="num">{cm(report.depth)}</td><td className="mrow__unit">cm</td></tr>
          <tr className="mrow"><td className="mrow__label">vertices</td><td className="num">{report.vertices.toLocaleString()}</td><td className="mrow__unit" /></tr>
          <tr className="mrow"><td className="mrow__label">surface area</td><td className="num">{report.surfaceArea?.toFixed(3) ?? '–'}</td><td className="mrow__unit">m²</td></tr>
          <tr className="mrow"><td className="mrow__label">volume</td><td className="num">{report.volume ? (report.volume * 1000).toFixed(1) : '–'}</td><td className="mrow__unit">l</td></tr>
        </tbody>
      </table>

      <table className="mtable">
        <thead><tr><th className="mtable__group">girths</th><th>at</th><th /></tr></thead>
        <tbody>
          {report.girths.map((g) => (
            <tr key={g.id} className="mrow">
              <td className="mrow__label">{g.label} <span className="muted">@ {cm(g.height)}</span></td>
              <td className="num">{g.value ? cm(g.value) : '–'}</td>
              <td className="mrow__unit">cm</td>
            </tr>
          ))}
        </tbody>
      </table>

      <figure className="chart">
        <figcaption className="chart__head">
          <span>girth profile</span>
          <span className="muted">cm × height m</span>
        </figcaption>
        <div className="chart__plot" style={{ height: 300 }}>
          <canvas ref={canvas} />
        </div>
        <p className="chart__note muted">
          bright: largest loop (torso) · dim: second loop (limb) · marks: named girths. {scan.indices ? '' : 'point cloud: area / volume need a mesh.'}
        </p>
      </figure>
    </div>
  );
}
