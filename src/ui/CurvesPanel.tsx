import type { GaitReport } from '../analysis/report';
import type { Side } from '../core/types';
import { mean } from '../core/signal';
import { grfFullScale, rgbCss, sideMagnitude } from '../core/colormap';
import { CycleChart } from './charts/CycleChart';

/** Where `frame` falls in each limb's current stride, as % of cycle. */
function cyclePosition(report: GaitReport, frame: number) {
  const out: { left?: number; right?: number } = {};
  for (const st of report.events.strides) {
    if (frame >= st.hs && frame < st.next) out[st.side] = (100 * (frame - st.hs)) / (st.next - st.hs);
  }
  return out;
}

export function CurvesPanel({ report, frame }: { report: GaitReport; frame: number }) {
  const cursor = cyclePosition(report, frame);
  const toeOff = mean(report.strides.map((s) => s.stancePct).filter(Number.isFinite));
  // "n" counts complete strides; a stride cut off by the end of the trial
  // still contributes its covered part of the curve and is counted apart.
  const strides = (s: Side) => {
    const st = report.events.strides.filter((x) => x.side === s);
    const partial = st.filter((x) => x.partial).length;
    return `${st.length - partial}${partial ? ` + ${partial} partial` : ''}`;
  };
  const grfFull = report.grf ? grfFullScale(report.grf.foot) : undefined;
  const ramp = (s: Side) => `linear-gradient(90deg, ${rgbCss(sideMagnitude(s, 0.3))}, ${rgbCss(sideMagnitude(s, 1))})`;
  return (
    <div className="curves">
      <p className="curves__legend">
        <span><i className="swatch--ramp" style={{ background: ramp('left') }} /> left (n={strides('left')})</span>
        <span><i className="swatch--ramp" style={{ background: ramp('right') }} /> right (n={strides('right')})</span>
        <span className="muted">mean ± 1 sd · % gait cycle · line shade: low → high{grfFull ? ` (grf: 0 → ${grfFull} ×BW)` : ''}</span>
      </p>
      {report.curves.map((c) => (
        <CycleChart key={c.id} curve={c} cursor={cursor} toeOff={toeOff} fullScale={c.unit === '×BW' ? grfFull : undefined} />
      ))}
    </div>
  );
}
