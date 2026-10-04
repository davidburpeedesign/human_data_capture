/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import ASX from './fixtures/07.asx?raw';
import AMC from './fixtures/07_01.amc?raw';
import { importFiles, listSkeletons, rebindSkeleton, registerSkeleton } from '../src/io/index';
import type { MotionClip } from '../src/core/types';

/**
 * Same skeleton with every bone 10 % longer: a stand-in for "the other
 * subject". Only lengths under :bonedata; `:units length` must stay put.
 */
const [HEAD, BONES] = ASX.split(':bonedata');
const TALL = `${HEAD}:bonedata${BONES.replace(/^(\s*length\s+)([\d.e+-]+)/gm, (_, k, v) => `${k}${(+v * 1.1).toPrecision(6)}`)}`;

const hipHeight = (c: MotionClip) => c.trajectories.get(c.landmarks.L_HJC!)!.data[1];

describe('choosing the skeleton for an .amc trial', () => {
  it('pairs by CMU name when it can, and says so', async () => {
    const { datasets } = await importFiles([new File([ASX], '07.asx'), new File([AMC], '07_01.amc')]);
    const clip = datasets[0] as MotionClip;
    expect(clip.source).toMatchObject({ skeleton: '07.asx', matched: 'name' });
  });

  it('falls back to the latest skeleton when names do not line up, flagged as a guess', async () => {
    registerSkeleton(TALL, 'subject_b.asx');
    const { datasets, errors } = await importFiles([new File([AMC], 'walk_take3.amc')]);
    expect(errors).toEqual([]);
    expect((datasets[0] as MotionClip).source).toMatchObject({ skeleton: 'subject_b.asx', matched: 'guessed' });
  });

  it('rebuilds a trial on another loaded skeleton', async () => {
    expect(listSkeletons()).toEqual(['07.asx', 'subject_b.asx']);
    const { datasets } = await importFiles([new File([AMC], '07_01.amc')]);
    const on07 = datasets[0] as MotionClip;
    const onTall = rebindSkeleton(on07, 'subject_b.asx');
    expect(onTall.source).toMatchObject({ skeleton: 'subject_b.asx', matched: 'chosen' });
    expect(onTall.id).not.toBe(on07.id);
    expect(onTall.frameCount).toBe(on07.frameCount);
    // Same motion on 10 % longer bones: hips sit ~10 % higher.
    expect(hipHeight(onTall) / hipHeight(on07)).toBeCloseTo(1.1, 1);
  });

  it('a re-loaded skeleton file replaces the old one', () => {
    registerSkeleton(ASX, 'subject_b.asx');
    expect(listSkeletons()).toEqual(['07.asx', 'subject_b.asx']);
  });
});
