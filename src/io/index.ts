/**
 * Single entry point for file ingestion: route by extension, then normalise
 * motion into the lab frame and resolve landmarks. Every importer stays
 * format-only; the shared post-processing lives here, once.
 *
 * ASF/AMC is the one paired format: an .amc trial is meaningless without
 * its skeleton (.asf, or .asx as the CMU database names it). Skeletons are
 * kept in a session registry so a subject's skeleton can be dropped once and
 * its trials afterwards, or all together; a trial can also be re-bound to
 * any loaded skeleton when names don't line up.
 */
import type { Dataset, MotionClip } from '../core/types';
import { resolveLandmarks } from '../core/landmarks';
import { parseAmc, parseAsf, type AsfSkeleton } from './asf';
import { parseBvh } from './bvh';
import { parseC3d } from './c3d';
import { parseMarkersCsv } from './markersCsv';
import { normalizeClip } from './normalize';
import { parseScan } from './scan';

export const ACCEPT = '.bvh,.asf,.asx,.amc,.c3d,.csv,.tsv,.txt,.ply,.obj,.stl';

export function prepareClip(raw: MotionClip): MotionClip {
  const resolved = resolveLandmarks(raw);
  // BVH and CSV carry no reliable unit; C3D and ASF/AMC convert to metres.
  const metric = raw.format === 'c3d' || raw.format === 'amc';
  return normalizeClip(resolved, metric ? { unitScale: 1 } : {});
}

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
/** Acclaim skeletons: `.asf`, or `.asx` as the CMU database ships them. */
const isSkeleton = (name: string) => ext(name) === 'asf' || ext(name) === 'asx';
const stem = (name: string) => name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

/** Skeletons loaded this session, keyed by file name, in load order. */
const skeletons = new Map<string, AsfSkeleton>();

export const listSkeletons = () => [...skeletons.keys()];

/**
 * Find the skeleton for an .amc trial. CMU names trials `<subject>_<trial>`,
 * so `02_01.amc` belongs to `02.asx`. With no name match we fall back to the
 * most recently loaded skeleton and say so (`guessed`): datasets don't always
 * follow CMU naming, and the sidebar lets the user pick the right one.
 */
export function skeletonFor(amcName: string): { name: string; skel: AsfSkeleton; matched: 'name' | 'guessed' } | undefined {
  const s = stem(amcName);
  const subject = s.split('_')[0];
  for (const want of [s, subject]) {
    for (const [name, skel] of skeletons) if (stem(name) === want) return { name, skel, matched: 'name' };
  }
  const last = [...skeletons].pop();
  return last ? { name: last[0], skel: last[1], matched: 'guessed' } : undefined;
}

/** Parse and register a skeleton; a re-loaded file name replaces the old one. */
export function registerSkeleton(text: string, name: string): AsfSkeleton {
  const skel = parseAsf(text, name);
  skeletons.delete(name);
  skeletons.set(name, skel);
  return skel;
}

function amcClip(text: string, amcName: string, skelName: string, skel: AsfSkeleton, matched: 'name' | 'guessed' | 'chosen'): MotionClip {
  const clip = prepareClip(parseAmc(text, skel, amcName));
  return { ...clip, source: { text, skeleton: skelName, matched } };
}

/** Rebuild a skeleton-driven trial on another loaded skeleton. */
export function rebindSkeleton(clip: MotionClip, skelName: string): MotionClip {
  const skel = skeletons.get(skelName);
  if (!clip.source || !skel) throw new Error(`cannot rebind ${clip.name} to ${skelName}`);
  return amcClip(clip.source.text, clip.name, skelName, skel, 'chosen');
}

export async function importFile(file: File): Promise<Dataset> {
  switch (ext(file.name)) {
    case 'bvh':
      return prepareClip(parseBvh(await file.text(), file.name));
    case 'amc': {
      const found = skeletonFor(file.name);
      if (!found) throw new Error(`no skeleton for ${file.name}: load its .asx / .asf too`);
      return amcClip(await file.text(), file.name, found.name, found.skel, found.matched);
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
  for (const f of files.filter((f) => isSkeleton(f.name))) {
    try {
      registerSkeleton(await f.text(), f.name);
      result.skeletons.push(f.name);
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  for (const f of files.filter((f) => !isSkeleton(f.name))) {
    try {
      result.datasets.push(await importFile(f));
    } catch (e) {
      result.errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return result;
}
