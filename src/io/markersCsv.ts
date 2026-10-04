/**
 * Delimited marker trajectories (CSV / TSV), the lowest-common-denominator
 * export. Accepts the two layouts seen in the wild:
 *
 *   wide-flat   time,LHEE_X,LHEE_Y,LHEE_Z,RHEE_X,...      one header row
 *   wide-split  ,LHEE,,,RHEE,,,                            marker row, then
 *               time,X,Y,Z,X,Y,Z                           an axis row
 *
 * A time / frame column is detected by name and used to derive the sample
 * rate; otherwise the caller's `rate` (default 100 Hz) is assumed.
 */
import type { MotionClip, Trajectory } from '../core/types';

export function parseMarkersCsv(text: string, name = 'markers.csv', rate = 100): MotionClip {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, '')));

  const isNumericRow = (r: string[]) => r.filter((c) => c !== '').every((c) => Number.isFinite(+c));
  let headerRows = 0;
  while (headerRows < rows.length && !isNumericRow(rows[headerRows])) headerRows++;
  if (headerRows === 0) throw new Error('csv: no header row');

  const width = Math.max(...rows.slice(0, headerRows).map((r) => r.length));
  const columns: string[] = [];
  if (headerRows >= 2) {
    // Marker row has the name once per triplet; carry it rightwards.
    const markerRow = rows[headerRows - 2];
    const axisRow = rows[headerRows - 1];
    let current = '';
    for (let c = 0; c < width; c++) {
      if (markerRow[c]) current = markerRow[c];
      columns.push(axisRow[c] && /^[xyz]$/i.test(axisRow[c]) ? `${current}_${axisRow[c]}` : axisRow[c] || markerRow[c] || '');
    }
  } else {
    columns.push(...rows[0]);
  }

  const body = rows.slice(headerRows).map((r) => r.map((c) => (c === '' ? NaN : +c)));
  const frameCount = body.length;

  const timeCol = columns.findIndex((c) => /^(time|t|seconds|sec)$/i.test(c));
  if (timeCol >= 0 && frameCount > 1) {
    const dt = (body[frameCount - 1][timeCol] - body[0][timeCol]) / (frameCount - 1);
    if (dt > 0) rate = 1 / dt;
  }

  const triplets = new Map<string, [number, number, number]>();
  columns.forEach((col, i) => {
    const m = col.match(/^(.*?)[\s_.:\-]*([xyz])$/i);
    if (!m || !m[1]) return;
    const marker = m[1];
    const axis = 'xyz'.indexOf(m[2].toLowerCase());
    const entry = triplets.get(marker) ?? [-1, -1, -1];
    entry[axis] = i;
    triplets.set(marker, entry);
  });

  const trajectories = new Map<string, Trajectory>();
  for (const [marker, idx] of triplets) {
    if (idx.some((i) => i < 0)) continue;
    const data = new Float32Array(frameCount * 3);
    for (let f = 0; f < frameCount; f++) {
      data[f * 3] = body[f][idx[0]];
      data[f * 3 + 1] = body[f][idx[1]];
      data[f * 3 + 2] = body[f][idx[2]];
    }
    trajectories.set(marker, { name: marker, data });
  }
  if (!trajectories.size) throw new Error('csv: no x/y/z marker columns found');

  return {
    kind: 'motion',
    id: `csv-${name}-${Date.now()}`,
    name,
    format: 'csv',
    rate,
    frameCount,
    trajectories,
    bones: [],
    landmarks: {},
    meta: { markers: trajectories.size },
  };
}
