import * as assert from 'assert';
import { poseAt, skin } from '../../formats/w3dPose';
import type { W3dAnimation } from '../../formats/w3dAnimation';
import type { SceneMesh, SceneSkeleton } from '../../formats/w3dScene';

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
});
