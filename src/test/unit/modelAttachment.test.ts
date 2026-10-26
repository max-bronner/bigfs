import * as assert from 'assert';
import { attachedModel } from '../../formats/particles/modelAttachment';
import type { ModelScene } from '../../formats/w3dScene';

suite('Model attachment', () => {
  test('bones are placed through their parents, turned by them', () => {
    const half = Math.SQRT1_2;
    const scene = {
      meshes: [
        {
          name: 'Body',
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ],
      textures: [],
      missing: [],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      skeleton: {
        name: 'Skl',
        names: ['ROOTTRANSFORM', 'ARM', 'HAND'],
        parents: [-1, 0, 1],
        // The arm turns 90° about z; the hand sits 2 along the arm's x
        translations: [0, 0, 5, 1, 0, 0, 2, 0, 0],
        rotations: [0, 0, 0, 1, 0, 0, half, half, 0, 0, 0, 1],
      },
    } as unknown as ModelScene;
    const model = attachedModel('Test', scene);

    assert.deepStrictEqual(model.triangles, [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepStrictEqual(
      model.bones.map((bone) => [
        bone.name,
        bone.position.map((value) => Math.round(value * 1000) / 1000),
      ]),
      [
        ['ROOTTRANSFORM', [0, 0, 5]],
        ['ARM', [1, 0, 5]],
        ['HAND', [1, 2, 5]],
      ],
    );
  });
});
