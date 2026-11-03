import * as assert from 'assert';
import { slerp } from '../../formats/w3d/w3dAnimation';
import {
  getMeshOpacity,
  isMeshShown,
  poseAt,
  skin,
} from '../../formats/w3d/w3dPose';
import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { SceneMesh, SceneSkeleton } from '../../formats/w3d/w3dScene';

const half = Math.SQRT1_2;
const skeleton: SceneSkeleton = {
  name: 'Skl',
  names: ['ROOTTRANSFORM', 'ARM', 'HAND'],
  parents: [-1, 0, 1],
  // The arm turns 90° about z; the hand sits 2 along the arm's x
  translations: [0, 0, 5, 1, 0, 0, 2, 0, 0],
  rotations: [0, 0, 0, 1, 0, 0, half, half, 0, 0, 0, 1],
};
const round = (values: ArrayLike<number>) =>
  Array.from(values, (value) => Math.round(value * 1000) / 1000 + 0);

suite('W3D pose', () => {
  test('bones are placed through their parents, turned by them', () => {
    assert.deepStrictEqual(
      poseAt(skeleton).world.map((bone) => round(bone.t)),
      [
        [0, 0, 5],
        [1, 0, 5],
        [1, 2, 5],
      ],
    );
  });

  test('a vertex follows its bone through an animated turn', () => {
    // The arm turns back by 90° half way through two frames
    const animation: W3dAnimation = {
      name: 'Skl.Wave',
      hierarchyName: 'Skl',
      frameCount: 2,
      frameRate: 30,
      channels: [
        {
          pivot: 1,
          kind: 'rotation',
          type: 6,
          values: new Float32Array([0, 0, 0, 1, 0, 0, -half, half]),
          present: new Uint8Array([1, 1]),
        },
      ],
    };
    const mesh = {
      positions: new Float32Array(3),
      local: {
        positions: new Float32Array([2, 0, 0]),
        bones: new Uint16Array([2, 0]),
        weights: new Float32Array([1, 0]),
      },
    } as SceneMesh;
    const out = new Float32Array(3);

    skin(mesh, poseAt(skeleton, animation, 1), out);
    // Bind turn and channel cancel: the hand points along x again
    assert.deepStrictEqual(round(out), [5, 0, 5]);
  });

  suite('between frames', () => {
    /** A one-channel animation of four frames */
    const clip = (
      kind: 'x' | 'opacity',
      values: number[],
      present: number[],
      extra: Partial<W3dAnimation> = {},
    ): W3dAnimation => ({
      name: 'Skl.Clip',
      hierarchyName: 'Skl',
      frameCount: values.length,
      frameRate: 30,
      channels: [
        {
          pivot: 1,
          kind,
          type: kind === 'x' ? 0 : 15,
          values: new Float32Array(values),
          present: new Uint8Array(present),
        },
      ],
      ...extra,
    });

    test('a compressed channel blends, a frame with no value as fully opaque', () => {
      const pose = poseAt(skeleton, clip('opacity', [0, 0.5, 0, 0], [0, 1, 0, 0]), 0.5);

      assert.strictEqual(pose.opacity[1], 0.75);
    });

    test('an uncompressed clip plays the nearest whole frame, ties to the even one', () => {
      const opacity = (frame: number) =>
        poseAt(
          skeleton,
          clip('opacity', [0.1, 0.2, 0.3, 0.4], [1, 1, 1, 1], { playsWholeFrames: true }),
          frame,
        ).opacity[1];

      assert.strictEqual(Math.fround(opacity(0.4)), Math.fround(0.1));
      assert.strictEqual(Math.fround(opacity(0.5)), Math.fround(0.1));
      assert.strictEqual(Math.fround(opacity(1.5)), Math.fround(0.3));
      assert.strictEqual(Math.fround(opacity(2.5)), Math.fround(0.3));
    });

    test('a frame before a held key keeps its value', () => {
      const animation = clip('opacity', [1, 0.2], [1, 1]);

      animation.channels[0].steps = new Uint8Array([1, 0]);
      assert.strictEqual(poseAt(skeleton, animation, 0.75).opacity[1], 1);
    });

    test('past its last frame an uncompressed clip is on frame 0', () => {
      const opacity = (extra: Partial<W3dAnimation>) =>
        poseAt(skeleton, clip('opacity', [1, 0], [1, 1], extra), 1.6).opacity[1];

      assert.strictEqual(opacity({ playsWholeFrames: true }), 1);
      assert.strictEqual(opacity({}), 0);
    });
  });

  test('a large turn between two frames moves at an even rate', () => {
    // A 150° turn about z, wider than a normalised blend keeps even
    const turn = (75 * Math.PI) / 180;
    const pose = poseAt(
      skeleton,
      {
        name: 'Skl.Swing',
        hierarchyName: 'Skl',
        frameCount: 2,
        frameRate: 30,
        channels: [
          {
            pivot: 2,
            kind: 'rotation',
            type: 6,
            values: new Float32Array([
              0,
              0,
              0,
              1,
              0,
              0,
              Math.sin(turn),
              Math.cos(turn),
            ]),
            present: new Uint8Array([1, 1]),
          },
        ],
      },
      0.25,
    );
    const hand = pose.world[2].q;
    const expected = (90 + 150 * 0.25) * (Math.PI / 360);

    assert.ok(Math.abs(hand[2] - Math.sin(expected)) < 1e-5);
    assert.ok(Math.abs(hand[3] - Math.cos(expected)) < 1e-5);
  });

  test('a rotation takes the short way across the double cover', () => {
    const halfWay = slerp([0, 0, 0, 1], [0, 0, 0, -1], 0.5);

    assert.deepStrictEqual(round(halfWay), [0, 0, 0, 1]);
  });

  test('a pose reads visibility and opacity per bone, not through parents', () => {
    const pose = poseAt(skeleton, {
      name: 'Skl.Fade',
      hierarchyName: 'Skl',
      frameCount: 1,
      frameRate: 30,
      channels: [
        {
          pivot: 1,
          kind: 'visibility',
          type: -1,
          values: new Float32Array([0]),
          present: new Uint8Array([1]),
        },
        {
          pivot: 2,
          kind: 'opacity',
          type: 15,
          values: new Float32Array([0.25]),
          present: new Uint8Array([1]),
        },
      ],
    });

    assert.deepStrictEqual(pose.visible, [true, false, true]);
    assert.deepStrictEqual(pose.opacity, [1, 1, 0.25]);
  });

  test('opacity outside its range is clamped, and a broken sample is clear', () => {
    const opacityOf = (value: number) =>
      poseAt(skeleton, {
        name: 'Skl.Fade',
        hierarchyName: 'Skl',
        frameCount: 1,
        frameRate: 30,
        channels: [
          {
            pivot: 1,
            kind: 'opacity',
            type: 15,
            values: new Float32Array([value]),
            present: new Uint8Array([1]),
          },
        ],
      }).opacity[1];

    assert.strictEqual(opacityOf(2), 1);
    assert.strictEqual(opacityOf(-0.5), 0);
    assert.strictEqual(opacityOf(NaN), 0);
  });

  test('only a rigid mesh answers to its bone', () => {
    const pose = poseAt(skeleton);

    pose.visible[1] = false;
    pose.opacity[1] = 0.5;

    const rigid = { bone: 1 } as SceneMesh;
    const skinned = {} as SceneMesh;

    assert.strictEqual(isMeshShown(rigid, pose), false);
    assert.strictEqual(getMeshOpacity(rigid, pose), 0.5);
    assert.strictEqual(isMeshShown(skinned, pose), true);
    assert.strictEqual(getMeshOpacity(skinned, pose), 1);
  });

  test('a stored rotation is used as it stands, not normalised', () => {
    const pose = poseAt(
      skeleton,
      {
        name: 'Skl.Long',
        hierarchyName: 'Skl',
        frameCount: 1,
        frameRate: 30,
        channels: [
          {
            pivot: 2,
            kind: 'rotation',
            type: 6,
            values: new Float32Array([0, 0, 0, 2]),
            present: new Uint8Array([1]),
          },
        ],
      },
      0,
    );

    // The hand takes the arm's unit turn, doubled in length by its own
    assert.ok(Math.abs(Math.hypot(...pose.world[2].q) - 2) < 1e-6);
  });

  test('a bone turns its channel translation by its whole bind, then adds the rotation', () => {
    const pose = poseAt(
      skeleton,
      {
        name: 'Skl.Order',
        hierarchyName: 'Skl',
        frameCount: 1,
        frameRate: 30,
        channels: [
          {
            pivot: 1,
            kind: 'x',
            type: 0,
            values: new Float32Array([1]),
            present: new Uint8Array([1]),
          },
        ],
      },
      0,
    );

    assert.deepStrictEqual(round(pose.world[1].t), [1, 1, 5]);
  });

  test('an uncompressed channel is the bind pose on a frame outside its range', () => {
    const rise = (frame: number) =>
      round(
        poseAt(
          skeleton,
          {
            name: 'Skl.Rise',
            hierarchyName: 'Skl',
            frameCount: 4,
            frameRate: 30,
            playsWholeFrames: true,
            channels: [
              {
                pivot: 2,
                kind: 'x',
                type: 0,
                values: new Float32Array([0, 3, 3, 0]),
                present: new Uint8Array([0, 1, 1, 0]),
              },
            ],
          },
          frame,
        ).world[2].t,
      );

    // In the bind pose the hand is at [1, 2, 5]; +x along the arm is +y here
    assert.deepStrictEqual(rise(1.5), [1, 5, 5]);
    assert.deepStrictEqual(rise(0.5), [1, 2, 5]);
    assert.deepStrictEqual(rise(2.6), [1, 2, 5]);
  });
});
