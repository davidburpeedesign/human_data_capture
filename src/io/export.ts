/**
 * Report export. JSON carries everything (metrics, per-stride rows, mean
 * curves) for downstream tooling; CSV is the per-stride table, which is what
 * people actually paste into a spreadsheet.
 */
import type { BodyScan, MotionClip } from '../core/types';
import type { GaitReport } from '../analysis/report';
import type { ScanReport } from '../analysis/scan';

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export function downloadJson(source: MotionClip | BodyScan, report: GaitReport | ScanReport) {
  const body =
    source.kind === 'motion'
      ? (() => {
          const r = report as GaitReport;
          return {
            source: { name: source.name, format: source.format, rate: source.rate, frames: source.frameCount },
            overground: r.overground,
            warnings: r.warnings,
            groups: r.groups,
            strides: r.strides,
            curves: r.curves,
            com: r.com && { method: r.com.method },
          };
        })()
      : { source: { name: source.name, format: source.format }, ...(report as ScanReport) };
  save(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }), `${stem(source.name)}.report.json`);
}

export function downloadCsv(clip: MotionClip, report: GaitReport) {
  if (!report.strides.length) return;
  const cols = Object.keys(report.strides[0]) as (keyof GaitReport['strides'][number])[];
  const rows = report.strides.map((s) =>
    cols.map((c) => (typeof s[c] === 'number' ? (Number.isFinite(s[c]) ? (s[c] as number).toFixed(4) : '') : s[c])).join(','),
  );
  save(new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }), `${stem(clip.name)}.strides.csv`);
}
