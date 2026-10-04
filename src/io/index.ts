/**
 * Single entry point for file ingestion: route by extension, then normalise
 * motion into the lab frame and resolve landmarks. Every importer stays
 * format-only; the shared post-processing lives here, once.
 *
 * ASF/AMC is the one paired format: an .amc trial is meaningless without
 * its .asf skeleton. Skeletons are kept in a session registry so a subject's
 * .asf can be dropped once and its trials afterwards, or all together.
 */
import type { Dataset, MotionClip } from '../core/types';
import { resolveLandmarks } from '../core/landmarks';
import { parseAmc, parseAsf, type AsfSkeleton } from './asf';
import { parseBvh } from './bvh';
import { parseC3d } from './c3d';
import { parseMarkersCsv } from './markersCsv';
import { normalizeClip } from './normalize';
import { parseScan } from './scan';

export const ACCEPT = '.bvh,.asf,.amc,.c3d,.csv,.tsv,.txt,.ply,.obj,.stl';

export function prepareClip(raw: MotionClip): MotionClip {
  const resolved = resolveLandmarks(raw);
  // BVH and CSV carry no reliable unit; C3D and ASF/AMC convert to metres.
  const metric = raw.format === 'c3d' || raw.format === 'amc';
  return normalizeClip(resolved, metric ? { unitScale: 1 } : {});
}

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const stem = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** Skeletons loaded this session, by file stem (CMU: `02` for `02.asf`). */
const skeletons = new Map<string, AsfSkeleton>();

/**
 * Find the skeleton for an .amc trial. CMU names trials `<subject>_<trial>`,
 * so `02_01.amc` belongs to `02.asf`; failing that, a lone loaded skeleton
 * is the only sensible match.
 */
export function skeletonFor(amcName: string): AsfSkeleton | undefined {
  const s = stem(amcName);
  const subject = s.split('_')[0];
  return skeletons.get(s) ?? skeletons.get(subject) ?? (skeletons.size === 1 ? [...skeletons.values()][0] : undefined);
}

export function registerSkeleton(text: string, name: string): AsfSkeleton {
  const skel = parseAsf(text, name);
  skeletons.set(stem(name), skel);
  return skel;
}

export async function importFile(file: File): Promise<Dataset> {
  switch (ext(file.name)) {
    case 'bvh':
      return prepareClip(parseBvh(await file.text(), file.name));
    case 'amc': {
      const skel = skeletonFor(file.name);
      if (!skel) throw new Error(`no skeleton for ${file.name}: load its .asf too`);
      return prepareClip(parseAmc(await file.text(), skel, file.name));
    }
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
      throw new Error(`unsupported file: .${ext(file.name)}`);
  }
}

export interface ImportResult {
  datasets: Dataset[];
  skeletons: string[];
  errors: string[];
}

/**
 * Import a batch (one drop / one file picker). Skeletons are registered
 * first so trials in the same batch find them regardless of file order.
 */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { datasets: [], skeletons: [], errors: [] };
  for (const f of files.filter((f) => ext(f.name) === 'asf')) {
    try {
      registerSkeleton(await f.text(), f.name);
      result.skeletons.push(f.name);
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  for (const f of files.filter((f) => ext(f.name) !== 'asf')) {
    try {
      result.datasets.push(await importFile(f));
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return result;
}
