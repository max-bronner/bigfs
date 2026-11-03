import * as assert from 'assert';
import {
  findAnimationCarrier,
  listModelCandidates,
  sortClipsBySkeleton,
} from '../../formats/w3d/w3dModelFinder';
import { describeForeignClip, isOwnClip, poseAt } from '../../formats/w3d/w3dPose';
import { findAnimation, parseW3dAnimations } from '../../formats/w3d/w3dAnimation';
import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import { buildW3dScene } from '../../formats/w3d/w3dScene';
import { createToolRegistry } from '../../core/toolRegistry';
import { buildChunk, concatBytes, encodeFloats, hierarchy, encodeName } from './w3d.test';

const u16 = (...values: number[]) =>
  new Uint8Array(Uint16Array.from(values).buffer);
const u8 = (...values: number[]) => Uint8Array.from(values);

/** An animation header: version, name, skeleton, frames, rate (and flavour) */
const buildHeader = (frames: number, compressed: boolean, flavor = 0) => {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);

  bytes.set(encodeName('UNIT_RUN', 16), 4);
  bytes.set(encodeName('UNIT_SKL', 16), 20);
  view.setUint32(36, frames, true);

  if (compressed) {
    view.setUint16(40, 30, true);
    view.setUint16(42, flavor, true);
  } else {
    view.setUint32(40, 15, true);
  }

  return buildChunk(compressed ? 0x281 : 0x201, bytes);
};

const values = (
  animation: { channels: { values: Float32Array; present: Uint8Array }[] },
  index: number,
) =>
  Array.from(animation.channels[index].values).map((value, frame) =>
    animation.channels[index].present[frame]
      ? Math.round(value * 1000) / 1000
      : null,
  );

suite('W3D animations on a skeleton', () => {
  const named = (file: string) => (bytes: Uint8Array) => [file, bytes] as const;
  const skeletonFile = (name: string, ...pivots: string[]) =>
    buildChunk(
      0x100,
      concatBytes(
        buildChunk(
          0x101,
          concatBytes(
            new Uint8Array(4),
            encodeName(name, 16),
            new Uint8Array(Uint32Array.of(pivots.length).buffer),
            encodeFloats(0, 0, 0),
          ),
        ),
        buildChunk(
          0x102,
          concatBytes(
            ...pivots.map((pivot, at) =>
              concatBytes(
                encodeName(pivot, 16),
                new Uint8Array(Uint32Array.of(at ? at - 1 : 0xffffffff).buffer),
                encodeFloats(0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
              ),
            ),
          ),
        ),
      ),
      true,
    );
  /** An animation of no channels naming a skeleton */
  const clipOf = (hierarchyName: string) => {
    const bytes = new Uint8Array(44);

    bytes.set(encodeName('CLIP', 16), 4);
    bytes.set(encodeName(hierarchyName, 16), 20);
    new DataView(bytes.buffer).setUint32(36, 1, true);

    return buildChunk(0x200, buildChunk(0x201, bytes), true);
  };
  const files = new Map([
    named('unit_skl.w3d')(skeletonFile('UNIT_SKL', 'ROOT', 'ARM')),
    named('copy_skl.w3d')(skeletonFile('COPY_SKL', 'root', 'arm')),
    named('other_skl.w3d')(skeletonFile('OTHER_SKL', 'ROOT', 'LEG')),
    named('unit_run.w3d')(clipOf('UNIT_SKL')),
    named('unit_copy.w3d')(clipOf('COPY_SKL')),
    named('unit_other.w3d')(clipOf('OTHER_SKL')),
    named('unit_lost.w3d')(clipOf('LOST_SKL')),
    named('unit_broken.w3d')(new Uint8Array([1, 0, 0, 0, 255, 255, 0, 0])),
  ]);
  const loadFile = async (fileName: string) =>
    files.get(fileName.toLowerCase());
  const skeleton = {
    name: 'UNIT_SKL',
    names: ['ROOT', 'ARM'],
    parents: [-1, 0],
    translations: [],
    rotations: [],
  };

  test("a clip of the same name, or a renamed copy of the rig, is the skeleton's own", () => {
    const clip = { hierarchyName: 'unit_skl' };

    assert.strictEqual(isOwnClip(skeleton, clip, undefined), true);
    assert.strictEqual(
      isOwnClip(
        skeleton,
        { hierarchyName: 'COPY_SKL' },
        { names: ['root', 'arm'], parents: [-1, 0] },
      ),
      true,
    );
  });

  test('another rig is foreign, by bone name, by parent, or by count, and the notice names it', () => {
    const clip = { name: 'CLIP', hierarchyName: 'OTHER_SKL' };

    for (const other of [
      { names: ['ROOT', 'LEG'], parents: [-1, 0] },
      { names: ['ROOT', 'ARM'], parents: [-1, -1] },
      { names: ['ROOT'], parents: [-1] },
      undefined,
    ]) {
      assert.strictEqual(isOwnClip(skeleton, clip, other), false);
    }
    assert.match(
      describeForeignClip(clip),
      /CLIP is made for OTHER_SKL; retail would apply it by bone number/,
    );
  });

  test('a clip of another rig still poses by bone number, and channels past the skeleton are dropped', () => {
    const [animation] = parseW3dAnimations(
      buildChunk(
        0x200,
        concatBytes(
          buildHeader(1, false),
          buildChunk(0x202, concatBytes(u16(0, 0, 1, 0, 1, 0), encodeFloats(5))),
          buildChunk(0x202, concatBytes(u16(0, 0, 1, 0, 9, 0), encodeFloats(5))),
        ),
        true,
      ),
    );
    const pose = poseAt(
      { ...skeleton, translations: [0, 0, 0, 0, 0, 0], rotations: [0, 0, 0, 1, 0, 0, 0, 1] },
      { ...animation, hierarchyName: 'OTHER_SKL' },
      0,
    );

    assert.strictEqual(pose.world.length, 2);
    assert.strictEqual(pose.world[1].t[0], 5);
  });

  test("the list puts the skeleton's own clips first and groups the rest", async () => {
    const clips = await sortClipsBySkeleton(
      skeleton,
      [
        'unit_skl.w3d',
        'unit_run.w3d',
        'unit_copy.w3d',
        'unit_other.w3d',
        'unit_lost.w3d',
        'unit_broken.w3d',
      ],
      loadFile,
      createToolRegistry(),
    );

    assert.deepStrictEqual(clips.own, ['unit_run.w3d', 'unit_copy.w3d']);
    assert.deepStrictEqual(clips.foreign, [
      { file: 'unit_other.w3d', hierarchyName: 'OTHER_SKL' },
      { file: 'unit_lost.w3d', hierarchyName: 'LOST_SKL' },
    ]);
  });

  test('the INI model carries a clip whatever its skeleton', async () => {
    const modelOn = (hierarchyName: string) =>
      buildChunk(
        0x700,
        buildChunk(
          0x701,
          concatBytes(
            new Uint8Array(8),
            encodeName('M', 16),
            encodeName(hierarchyName, 16),
          ),
        ),
        true,
      );
    const withModels = new Map([
      ...files,
      named('other_skn.w3d')(modelOn('OTHER_SKL')),
      named('copy_skn.w3d')(modelOn('COPY_SKL')),
    ]);
    const load = async (fileName: string) =>
      withModels.get(fileName.toLowerCase());
    const tools = createToolRegistry();
    const carry = (iniModel: string) =>
      findAnimationCarrier('UNIT_SKL', iniModel, async () => [], load, tools);

    assert.strictEqual((await carry('other_skn.w3d')).name, 'other_skn.w3d');
    assert.strictEqual((await carry('copy_skn.w3d')).name, 'copy_skn.w3d');
  });
});

suite('W3D opacity channels', () => {
  test('channel type 15 reads as opacity, and a frame outside it as none', () => {
    const [animation] = parseW3dAnimations(
      buildChunk(
        0x200,
        concatBytes(
          buildHeader(4, false),
          buildChunk(0x202, concatBytes(u16(1, 2, 1, 15, 1, 0), encodeFloats(0.5, 0.25))),
        ),
        true,
      ),
    );
    const [channel] = animation.channels;

    assert.strictEqual(channel.kind, 'opacity');
    assert.deepStrictEqual(Array.from(channel.present), [0, 1, 1, 0]);
  });
});

suite('W3D animations', () => {
  test('dense, bit and motion channels sample at every frame', () => {
    const [animation] = parseW3dAnimations(
      concatBytes(
        buildChunk(
          0x200,
          concatBytes(
            buildHeader(4, false),
            // z of bone 1, frames 1 to 2
            buildChunk(0x202, concatBytes(u16(1, 2, 1, 2, 1, 0), encodeFloats(5, 6))),
            // visibility of bone 1, frames 0 to 3: shown on 0 and 2
            buildChunk(0x203, concatBytes(u16(0, 3, 0, 1), u8(0, 0b0101))),
          ),
          true,
        ),
      ),
    );

    assert.strictEqual(animation.hierarchyName, 'UNIT_SKL');
    assert.strictEqual(animation.frameRate, 15);
    assert.deepStrictEqual(values(animation, 0), [null, 5, 6, null]);
    assert.deepStrictEqual(values(animation, 1), [1, 0, 1, 0]);
  });

  test('time-coded keys blend, and a held key steps', () => {
    const [animation] = parseW3dAnimations(
      buildChunk(
        0x280,
        concatBytes(
          buildHeader(5, true, 0),
          // x of bone 2: 0 at frame 0, 8 at frame 4
          buildChunk(
            0x282,
            concatBytes(
              new Uint8Array(Uint32Array.of(2).buffer),
              u16(2),
              u8(1, 0),
              new Uint8Array(Uint32Array.of(0).buffer),
              encodeFloats(0),
              new Uint8Array(Uint32Array.of(4).buffer),
              encodeFloats(8),
            ),
          ),
          // motion channel, y of bone 2: 0 at 0, then 10 held from frame 2
          buildChunk(
            0x284,
            concatBytes(
              u8(0, 0, 1, 1),
              u16(2, 2),
              u16(0, 0x8000 | 2),
              encodeFloats(0, 10),
            ),
          ),
        ),
        true,
      ),
    );

    assert.deepStrictEqual(values(animation, 0), [0, 2, 4, 6, 8]);
    assert.deepStrictEqual(values(animation, 1), [0, 0, 10, 10, 10]);
  });

  test('adaptive deltas rebuild from frame 0 and hold their last value', () => {
    const [animation] = parseW3dAnimations(
      buildChunk(
        0x280,
        concatBytes(
          buildHeader(5, true, 1),
          // three frames: 5, then +1, then -2, at a step of 1e0
          buildChunk(
            0x282,
            concatBytes(
              new Uint8Array(Uint32Array.of(3).buffer),
              u16(1),
              u8(1, 0),
              encodeFloats(1, 5),
              u8(8, 0xe1, 0, 0, 0, 0, 0, 0, 0),
            ),
          ),
        ),
        true,
      ),
    );

    assert.deepStrictEqual(values(animation, 0), [5, 6, 4, 4, 4]);
  });

  test('an animation file shows on its skeleton, ready to play', async () => {
    const file = buildChunk(
      0x200,
      concatBytes(
        buildHeader(2, false),
        buildChunk(0x202, concatBytes(u16(0, 1, 1, 2, 1, 0), encodeFloats(0, 3))),
      ),
      true,
    );
    const scene = await buildW3dScene(
      file,
      async (fileName) => (fileName === 'UNIT_SKL.w3d' ? hierarchy : undefined),
      createToolRegistry(),
    );

    assert.strictEqual(scene.animation?.name, 'UNIT_RUN');
    assert.strictEqual(scene.skeleton?.name, 'UNIT_SKL');
  });
});

suite('W3D model for a skeleton', () => {
  test("the unit's skinned model is tried first, never the skeleton itself", () => {
    assert.deepStrictEqual(
      listModelCandidates('GUArcher_SKL', [
        'guarcher_atka.w3d',
        'GUArcher_SKL.w3d',
        'guarcher.w3d',
        'guarcher_skn.w3d',
        'guarcher_hat_skn.w3d',
        'gufighter_skn.w3d',
      ]),
      [
        'guarcher_skn.w3d',
        'guarcher.w3d',
        'guarcher_hat_skn.w3d',
        'guarcher_atka.w3d',
      ],
    );
  });

  test('an INI line names an animation by skeleton and clip', () => {
    const clip = (name: string, hierarchyName: string): W3dAnimation => ({
      name,
      hierarchyName,
      frameCount: 1,
      frameRate: 30,
      channels: [],
    });
    const animations = [
      clip('UNIT_IDLE', 'UNIT_SKL'),
      clip('UNIT_RUN', 'UNIT_SKL'),
    ];

    assert.strictEqual(
      findAnimation(animations, 'UNIT_SKL.UNIT_RUN'),
      animations[1],
    );
    assert.strictEqual(
      findAnimation(animations, 'unit_skl.unit_run'),
      animations[1],
    );
    assert.strictEqual(
      findAnimation(animations, 'OTHER_SKL.UNIT_RUN'),
      animations[1],
    );
    assert.strictEqual(
      findAnimation(animations, 'UNIT_SKL.MISSING'),
      animations[0],
    );
    assert.strictEqual(findAnimation([], 'A.B'), undefined);
  });

  test('a channel that ends early fails with a message', () => {
    assert.throws(
      () =>
        parseW3dAnimations(
          buildChunk(
            0x200,
            concatBytes(
              buildHeader(4, false),
              // frames 1 to 2 need two floats, only one follows
              buildChunk(0x202, concatBytes(u16(1, 2, 1, 2, 1, 0), encodeFloats(5))),
            ),
          ),
        ),
      /animation channel ends early/,
    );
  });
});
