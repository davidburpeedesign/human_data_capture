import type { GaitReport } from '../analysis/report';
import type { Side } from '../core/types';
import { mean } from '../core/signal';
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
  const strides = (s: Side) => report.strides.filter((x) => x.side === s).length;
  return (
    <div className="curves">
      <p className="curves__legend">
        <span><i style={{ background: 'var(--data-left)' }} /> left (n={strides('left')})</span>
        <span><i style={{ background: 'var(--data-right)' }} /> right (n={strides('right')})</span>
        <span className="muted">mean ± 1 sd · % gait cycle</span>
      </p>
      {report.curves.map((c) => (
        <CycleChart key={c.id} curve={c} cursor={cursor} toeOff={toeOff} />
      ))}
    </div>
  );
}
