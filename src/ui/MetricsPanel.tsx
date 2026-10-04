/**
 * Metric table: one block per group, rows show left / right / symmetry or
 * the pooled value. Status is always spelled out, never colour alone.
 */
import type { GaitReport, Metric, Stat } from '../analysis/report';

const DIGITS: Record<string, number> = {
  m: 3, 'm/s': 2, s: 3, ms: 0, deg: 1, 'deg/s': 0, cm: 1, '%': 1, '% cycle': 1, '% stance': 0, 'cv %': 1, 'steps/min': 1, '% (r−l)': 1,
};

function fmt(s: Stat | undefined, unit: string) {
  if (!s || !Number.isFinite(s.mean)) return '–';
  return s.mean.toFixed(DIGITS[unit] ?? 2);
}

function Row({ m }: { m: Metric }) {
  const sidedRow = m.left || m.right;
  return (
    <tr className={m.status === 'unavailable' ? 'mrow mrow--na' : 'mrow'} title={m.note}>
      <td className="mrow__label">
        {m.label}
        {m.status === 'proxy' && <em className="tag tag--proxy">proxy</em>}
        {m.status === 'unavailable' && <em className="tag tag--na">n/a</em>}
      </td>
      {sidedRow ? (
        <>
          <td className="num">{fmt(m.left, m.unit)}</td>
          <td className="num">{fmt(m.right, m.unit)}</td>
          <td className="num muted">{m.symmetry !== undefined ? `${m.symmetry > 0 ? '+' : ''}${m.symmetry.toFixed(1)}` : ''}</td>
        </>
      ) : (
        <td className="num" colSpan={3}>{fmt(m.both, m.unit)}</td>
      )}
      <td className="mrow__unit">{m.unit}</td>
    </tr>
  );
}

export function MetricsPanel({ report }: { report: GaitReport }) {
  const n = { l: report.strides.filter((s) => s.side === 'left').length, r: report.strides.filter((s) => s.side === 'right').length };
  return (
    <div className="metrics">
      <p className="metrics__summary muted">
        {report.overground ? 'overground' : 'treadmill'} · {n.l} left / {n.r} right strides
        {report.com && ` · com: ${report.com.method}`}
      </p>
      {report.groups.map((g) => (
        <table key={g.id} className="mtable">
          <thead>
            <tr>
              <th className="mtable__group">{g.label}</th>
              <th>l</th>
              <th>r</th>
              <th>si %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {g.metrics.map((m) => <Row key={m.id} m={m} />)}
          </tbody>
        </table>
      ))}
    </div>
  );
}
