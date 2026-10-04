import { describe, expect, it } from 'vitest';
import { parseBvh } from '../src/io/bvh';
import { parseMarkersCsv } from '../src/io/markersCsv';
import { parseC3d } from '../src/io/c3d';
import { prepareClip } from '../src/io/index';

const LEG = (side: 'Left' | 'Right', x: number) => `
  JOINT ${side}UpLeg
  {
    OFFSET ${x} -5 0
    CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT ${side}Leg
    {
      OFFSET 0 -45 0
      CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT ${side}Foot
      {
        OFFSET 0 -44 0
        CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT ${side}ToeBase
        {
          OFFSET 0 -6 15
          CHANNELS 3 Zrotation Xrotation Yrotation
          End Site
          {
            OFFSET 0 0 4
          }
        }
      }
    }
  }`;

describe('bvh', () => {
  const frames = 3;
  const text = `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
${LEG('Left', 9)}
${LEG('Right', -9)}
}
MOTION
Frames: ${frames}
Frame Time: 0.01
${Array.from({ length: frames }, (_, f) => [0, 100, f * 1.2, 0, 0, 0, ...Array(24).fill(0)].join(' ')).join('\n')}
`;

  it('runs forward kinematics in rest pose', () => {
    const clip = parseBvh(text);
    expect(clip.frameCount).toBe(3);
    expect(clip.rate).toBeCloseTo(100);
    const knee = clip.trajectories.get('LeftLeg')!.data;
    expect([knee[0], knee[1], knee[2]]).toEqual([9, 50, 0]);
  });

  it('emits canonical virtual markers that resolve and normalise to metres', () => {
    const clip = prepareClip(parseBvh(text));
    for (const id of ['L_HJC', 'R_HJC', 'L_KNEE_MED', 'R_ANKLE_LAT', 'L_HEEL', 'R_TOE', 'L_MT1', 'SACRUM'] as const) {
      expect(clip.landmarks[id], id).toBeTruthy();
    }
    // Hip ~0.95 m above the floor after unit detection (cm → m).
    const hjc = clip.trajectories.get(clip.landmarks.L_HJC!)!.data;
    expect(hjc[1]).toBeGreaterThan(0.85);
    expect(hjc[1]).toBeLessThan(1.05);
  });
});

describe('csv markers', () => {
  it('reads the flat wide layout and derives the rate from time', () => {
    const csv = 'time,LHEE_X,LHEE_Y,LHEE_Z\n0,1,2,3\n0.005,1,2,3\n0.01,1,2,3\n';
    const clip = parseMarkersCsv(csv);
    expect(clip.rate).toBeCloseTo(200);
    expect(clip.trajectories.get('LHEE')!.data[2]).toBe(3);
  });

  it('reads the split two-row header layout', () => {
    const csv = ',LHEE,,,RHEE,,\nframe,X,Y,Z,X,Y,Z\n1,1,2,3,4,5,6\n2,1,2,3,4,5,6\n';
    const clip = parseMarkersCsv(csv, 'x.csv', 50);
    expect([...clip.trajectories.keys()]).toEqual(['LHEE', 'RHEE']);
    expect(clip.trajectories.get('RHEE')!.data[0]).toBe(4);
  });
});

/** Minimal float C3D writer, just enough to round-trip points + labels. */
function writeC3d(labels: string[], frames: number[][][], rate: number): ArrayBuffer {
  const params: number[] = [];
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const i16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const f32 = (v: number) => [...new Uint8Array(new Float32Array([v]).buffer)];
  const group = (id: number, name: string) => {
    params.push(name.length, -id & 0xff, ...str(name), ...i16(3), 0);
  };
  const param = (gid: number, name: string, type: number, dims: number[], data: number[]) => {
    const body = [type & 0xff, dims.length, ...dims, ...data, 0];
    params.push(name.length, gid, ...str(name), ...i16(2 + body.length), ...body);
  };
  group(1, 'POINT');
  param(1, 'SCALE', 4, [], f32(-1));
  param(1, 'RATE', 4, [], f32(rate));
  param(1, 'UNITS', -1, [2], str('mm'));
  const w = 4;
  param(1, 'LABELS', -1, [w, labels.length], labels.flatMap((l) => str(l.padEnd(w))));
  params.push(0, 0, 0, 0); // terminator

  const paramBlocks = Math.ceil((params.length + 4) / 512);
  const dataStart = 2 + paramBlocks;
  const buf = new ArrayBuffer((dataStart - 1) * 512 + frames.length * labels.length * 16 + 512);
  const v = new DataView(buf);
  v.setUint8(0, 2); v.setUint8(1, 0x50);
  v.setUint16(2, labels.length, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 1, true);
  v.setUint16(8, frames.length, true);
  v.setFloat32(12, -1, true);
  v.setUint16(16, dataStart, true);
  v.setFloat32(20, rate, true);
  const ps = 512;
  v.setUint8(ps + 2, paramBlocks);
  v.setUint8(ps + 3, 84);
  params.forEach((b, i) => v.setUint8(ps + 4 + i, b & 0xff));
  let o = (dataStart - 1) * 512;
  for (const f of frames) for (const p of f) {
    v.setFloat32(o, p[0], true); v.setFloat32(o + 4, p[1], true); v.setFloat32(o + 8, p[2], true);
    v.setFloat32(o + 12, p[3] ?? 0, true);
    o += 16;
  }
  return buf;
}

describe('c3d', () => {
  it('round-trips float point data, labels, units and gaps', () => {
    const buf = writeC3d(['LHEE', 'RHEE'], [
      [[100, 200, 300], [400, 500, 600]],
      [[110, 210, 310], [0, 0, 0, -1]],
    ], 100);
    const clip = parseC3d(buf);
    expect(clip.rate).toBe(100);
    expect(clip.frameCount).toBe(2);
    const l = clip.trajectories.get('LHEE')!.data;
    expect(l[3]).toBeCloseTo(0.11);
    expect(Number.isNaN(clip.trajectories.get('RHEE')!.data[3])).toBe(true);
  });
});
