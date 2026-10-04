/**
 * Transport + gait diagram. Each limb gets a row; stance phases are bars in
 * the limb's data colour, so double support reads as overlap at a glance.
 * Click or drag anywhere on the track to scrub.
 */
import { useEffect, useRef } from 'react';
import type { MotionClip } from '../core/types';
import type { GaitReport } from '../analysis/report';
import { GRF_FULL_SCALE, rgbCss, sideMagnitude } from '../core/colormap';

interface Props {
  clip: MotionClip;
  report: GaitReport;
  frame: number;
  playing: boolean;
  speed: number;
  onFrame: (f: number) => void;
  onPlay: () => void;
  onSpeed: (s: number) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function Timeline({ clip, report, frame, playing, speed, onFrame, onPlay, onSpeed }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const x = (f: number) => (f / (clip.frameCount - 1)) * w;
    const rowH = 10;
    const rows = { left: 6, right: 26 };
    // Force strip under each stance row: per-frame |GRF| on the magnitude
    // ramp, black (no load) toward the foot's own hue.
    const stripH = 4;

    // Seconds grid.
    ctx.strokeStyle = css('--line-soft');
    ctx.fillStyle = css('--text-faint');
    ctx.font = `11px ${css('--font-mono')}`;
    ctx.lineWidth = 1;
    const secs = clip.frameCount / clip.rate;
    for (let t = 0; t <= secs; t++) {
      const px = Math.round(x(t * clip.rate)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.fillText(`${t}s`, px + 3, h - 4);
    }

    for (const side of ['left', 'right'] as const) {
      const y = rows[side];
      ctx.fillStyle = css('--text-muted');
      ctx.fillText(side[0], 2, y + 9);
      ctx.fillStyle = css(side === 'left' ? '--data-left' : '--data-right');
      const hs = report.events.heelStrikes[side];
      const to = report.events.toeOffs[side];
      for (const h0 of hs) {
        const t = to.find((v) => v > h0);
        const end = t ?? h0;
        // 2px surface gap between consecutive stance bars.
        ctx.fillRect(x(h0) + 1, y, Math.max(1, x(end) - x(h0) - 2), rowH);
      }
      if (report.grf) {
        const F = report.grf.foot[side];
        const step = Math.max(1, Math.floor(clip.frameCount / w));
        for (let f = 0; f < clip.frameCount; f += step) {
          const mag = Math.hypot(F[f][0], F[f][1], F[f][2]);
          ctx.fillStyle = rgbCss(sideMagnitude(side, mag / GRF_FULL_SCALE));
          ctx.fillRect(x(f), y + rowH + 1, Math.max(1, x(f + step) - x(f) + 0.5), stripH);
        }
      }
    }

    // Playhead in white, not the coral accent: coral sits too close to the
    // left-stance red to read as a separate mark on this track.
    ctx.fillStyle = css('--text-emphasis');
    ctx.fillRect(Math.round(x(frame)) - 1, 0, 2, h);
  }, [clip, report, frame]);

  const scrub = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const f = Math.round(((e.clientX - r.left) / r.width) * (clip.frameCount - 1));
    onFrame(Math.max(0, Math.min(clip.frameCount - 1, f)));
  };

  return (
    <div className="timeline">
      <div className="timeline__transport">
        <button className="btn" onClick={onPlay}>{playing ? 'pause' : 'play'}</button>
        <select value={speed} onChange={(e) => onSpeed(+e.target.value)} aria-label="playback speed">
          {[0.1, 0.25, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <span className="timeline__time">
          {(frame / clip.rate).toFixed(2)}s · f{String(frame).padStart(4, '0')}
        </span>
        <span className="timeline__legend">
          <i style={{ background: 'var(--data-left)' }} /> left stance
          <i style={{ background: 'var(--data-right)' }} /> right stance
        </span>
      </div>
      <canvas
        ref={canvas}
        className="timeline__track"
        onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture(e.pointerId); scrub(e); }}
        onPointerMove={(e) => dragging.current && scrub(e)}
        onPointerUp={() => { dragging.current = false; }}
      />
    </div>
  );
}
