import * as assert from 'assert';
import { parseW3dAnimations } from '../../formats/w3dAnimation';
import type { W3dAnimation } from '../../formats/w3dAnimation';
import {
  easeAnimation,
  retimeAnimation,
  reverseAnimation,
  trimAnimation,
  writeW3dAnimation,
} from '../../formats/w3dAnimationEdit';

/** A bone sliding 0 to 30 along x over 4 frames, turning, and shown from frame 2 */
const animation = (): W3dAnimation => {
  const half = Math.SQRT1_2;

  return {
    name: 'TEST_RUN',
    hierarchyName: 'TEST_SKL',
    frameCount: 4,
    frameRate: 30,
    channels: [
      {
        pivot: 1,
        kind: 'x',
        type: 0,
        values: new Float32Array([0, 10, 20, 30]),
        present: new Uint8Array([1, 1, 1, 1]),
      },
      {
        pivot: 1,
        kind: 'rotation',
        type: 6,
        values: new Float32Array([
          0,
          0,
          0,
          1,
          0,
          0,
          half,
          half,
          0,
          0,
          1,
          0,
          0,
          0,
          1,
          0,
        ]),
        present: new Uint8Array([1, 1, 1, 1]),
      },
      {
        pivot: 2,
        kind: 'visibility',
        type: -1,
        values: new Float32Array([0, 0, 1, 1]),
        present: new Uint8Array([1, 1, 1, 1]),
      },
    ],
  };
};

const xs = (anim: W3dAnimation) =>
  Array.from(anim.channels[0].values).map(
    (value) => Math.round(value * 100) / 100,
  );

suite('W3D animation editing', () => {
  test('retimed, reversed, eased and trimmed', () => {
    assert.deepStrictEqual(
      xs(retimeAnimation(animation(), 7)),
      [0, 5, 10, 15, 20, 25, 30],
    );
    assert.deepStrictEqual(xs(reverseAnimation(animation())), [30, 20, 10, 0]);
    assert.deepStrictEqual(
      xs(easeAnimation(animation(), 'easeIn')),
      [0, 3.33, 13.33, 30],
    );
    assert.deepStrictEqual(xs(trimAnimation(animation(), 1, 2)), [10, 20]);
    // A rotation half way between keys stays a unit quaternion
    const turned = retimeAnimation(animation(), 7).channels[1].values;

    assert.ok(Math.abs(Math.hypot(...turned.subarray(4, 8)) - 1) < 1e-5);
  });

  test('written as an uncompressed animation, it reads back the same', () => {
    const [back] = parseW3dAnimations(
      writeW3dAnimation(retimeAnimation(animation(), 7)),
    );
    const source = retimeAnimation(animation(), 7);

    assert.strictEqual(back.name, 'TEST_RUN');
    assert.strictEqual(back.hierarchyName, 'TEST_SKL');
    assert.strictEqual(back.frameCount, 7);
    assert.deepStrictEqual(
      back.channels.map((channel) => [
        channel.pivot,
        channel.kind,
        channel.type,
      ]),
      [
        [1, 'x', 0],
        [1, 'rotation', 6],
        [2, 'visibility', -1],
      ],
    );
    back.channels.forEach((channel, index) =>
      assert.deepStrictEqual(channel.values, source.channels[index].values),
    );
  });
});
