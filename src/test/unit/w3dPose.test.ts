import * as assert from 'assert';
import { slerp } from '../../formats/w3d/w3dAnimation';
import { poseAt, skin } from '../../formats/w3d/w3dPose';
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
        bones: new Uint16Array([2]),
      },
    } as SceneMesh;
    const out = new Float32Array(3);

    skin(mesh, poseAt(skeleton, animation, 1), out);
    // Bind turn and channel cancel: the hand points along x again
    assert.deepStrictEqual(round(out), [5, 0, 5]);
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

  test('a frame just outside a dense channel holds the bind pose', () => {
    const rise = (frame: number) =>
      round(
        poseAt(
          skeleton,
          {
            name: 'Skl.Rise',
            hierarchyName: 'Skl',
            frameCount: 4,
            frameRate: 30,
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
    assert.deepStrictEqual(rise(2.5), [1, 2, 5]);
  });
});
