/**
 * 3D body scan importer: PLY (binary or ascii, mesh or point cloud), OBJ and
 * STL, via three.js's loaders. Output is a flat `BodyScan` in the lab frame.
 *
 * Scanners rarely agree on orientation or units. We assume the person is
 * standing, so the longest bounding-box axis is "up", and that a standing
 * adult is 1–2.2 m tall, which settles mm / cm / m without asking.
 */
import type { BufferGeometry } from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyScan } from '../core/types';

export function parseScan(buffer: ArrayBuffer, name: string): BodyScan {
  const ext = name.split('.').pop()?.toLowerCase();
  let geometry: BufferGeometry;
  let format: BodyScan['format'];

  if (ext === 'ply') {
    geometry = new PLYLoader().parse(buffer);
    format = 'ply';
  } else if (ext === 'stl') {
    // STL is triangle soup; weld it so area/volume/topology are meaningful.
    geometry = mergeVertices(new STLLoader().parse(buffer));
    format = 'stl';
  } else if (ext === 'obj') {
    const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
    const meshes: BufferGeometry[] = [];
    group.traverse((o) => {
      const g = (o as { geometry?: BufferGeometry }).geometry;
      if (g) meshes.push(g);
    });
    if (!meshes.length) throw new Error('obj: no geometry');
    geometry = mergeVertices(meshes[0].deleteAttribute('normal').deleteAttribute('uv'));
    format = 'obj';
  } else {
    throw new Error(`unsupported scan format: .${ext}`);
  }

  const src = geometry.getAttribute('position').array as Float32Array;
  const colorAttr = geometry.getAttribute('color');
  const index = geometry.getIndex();

  // ── orient + scale ───────────────────────────────────────────────────
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < src.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], src[i + a]);
      max[a] = Math.max(max[a], src[i + a]);
    }
  }
  const ext3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const upAxis = ext3.indexOf(Math.max(...ext3));
  const tall = ext3[upAxis];
  const unit = tall > 100 ? 0.001 : tall > 10 ? 0.01 : 1;

  // Map source axes so up → Y; keep the other two in cyclic order (no mirror).
  const order = [(upAxis + 2) % 3, upAxis, (upAxis + 1) % 3];
  const cx = (min[order[0]] + max[order[0]]) / 2;
  const cz = (min[order[2]] + max[order[2]]) / 2;
  const floor = min[upAxis];

  const positions = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    positions[i] = (src[i + order[0]] - cx) * unit;
    positions[i + 1] = (src[i + order[1]] - floor) * unit;
    positions[i + 2] = (src[i + order[2]] - cz) * unit;
  }

  return {
    kind: 'scan',
    id: `scan-${name}-${Date.now()}`,
    name,
    format,
    positions,
    indices: index ? new Uint32Array(index.array) : null,
    colors: colorAttr ? new Float32Array(colorAttr.array) : null,
    meta: { vertices: positions.length / 3, faces: index ? index.count / 3 : 0, unit_scale: unit },
  };
}
