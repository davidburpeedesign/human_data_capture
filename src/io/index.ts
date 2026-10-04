/**
 * Single entry point for file ingestion: route by extension, then normalise
 * motion into the lab frame and resolve landmarks. Every importer stays
 * format-only; the shared post-processing lives here, once.
 */
import type { Dataset, MotionClip } from '../core/types';
import { resolveLandmarks } from '../core/landmarks';
import { parseBvh } from './bvh';
import { parseC3d } from './c3d';
import { parseMarkersCsv } from './markersCsv';
import { normalizeClip } from './normalize';
import { parseScan } from './scan';

export const ACCEPT = '.bvh,.c3d,.csv,.tsv,.txt,.ply,.obj,.stl';

export function prepareClip(raw: MotionClip): MotionClip {
  const resolved = resolveLandmarks(raw);
  // BVH and CSV carry no reliable unit; C3D was already converted to metres.
  return normalizeClip(resolved, raw.format === 'c3d' ? { unitScale: 1 } : {});
}

export async function importFile(file: File): Promise<Dataset> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'bvh':
      return prepareClip(parseBvh(await file.text(), file.name));
    case 'c3d':
      return prepareClip(parseC3d(await file.arrayBuffer(), file.name));
    case 'csv':
    case 'tsv':
    case 'txt':
      return prepareClip(parseMarkersCsv(await file.text(), file.name));
    case 'ply':
    case 'obj':
    case 'stl':
      return parseScan(await file.arrayBuffer(), file.name);
    default:
      throw new Error(`unsupported file: .${ext}`);
  }
}
