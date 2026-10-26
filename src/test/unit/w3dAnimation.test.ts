import * as assert from 'assert';
import { modelCandidates } from '../../formats/w3dModelFinder';
import { parseW3dAnimations } from '../../formats/w3dAnimation';
import { buildW3dScene } from '../../formats/w3dScene';
import { createToolRegistry } from '../../tools/toolRegistry';
import { chunk, concat, floats, hierarchy, name } from './w3d.test';

const u16 = (...values: number[]) =>
  new Uint8Array(Uint16Array.from(values).buffer);
const u8 = (...values: number[]) => Uint8Array.from(values);

/** An animation header: version, name, skeleton, frames, rate (and flavour) */
const header = (frames: number, compressed: boolean, flavor = 0) => {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);

  bytes.set(name('UNIT_RUN', 16), 4);
  bytes.set(name('UNIT_SKL', 16), 20);
  view.setUint32(36, frames, true);

  if (compressed) {
    view.setUint16(40, 30, true);
    view.setUint16(42, flavor, true);
  } else {
    view.setUint32(40, 15, true);
  }

  return chunk(compressed ? 0x281 : 0x201, bytes);
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

suite('W3D animations', () => {
  test('dense, bit and motion channels sample at every frame', () => {
    const [animation] = parseW3dAnimations(
      concat(
        chunk(
          0x200,
          concat(
            header(4, false),
            // z of bone 1, frames 1 to 2
            chunk(0x202, concat(u16(1, 2, 1, 2, 1, 0), floats(5, 6))),
            // visibility of bone 1, frames 0 to 3: shown on 0 and 2
            chunk(0x203, concat(u16(0, 3, 0, 1), u8(0, 0b0101))),
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
      chunk(
        0x280,
        concat(
          header(5, true, 0),
          // x of bone 2: 0 at frame 0, 8 at frame 4
          chunk(
            0x282,
            concat(
              new Uint8Array(Uint32Array.of(2).buffer),
              u16(2),
              u8(1, 0),
              new Uint8Array(Uint32Array.of(0).buffer),
              floats(0),
              new Uint8Array(Uint32Array.of(4).buffer),
              floats(8),
            ),
          ),
          // motion channel, y of bone 2: 0 at 0, then 10 held from frame 2
          chunk(
            0x284,
            concat(
              u8(0, 0, 1, 1),
              u16(2, 2),
              u16(0, 0x8000 | 2),
              floats(0, 10),
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
      chunk(
        0x280,
        concat(
          header(5, true, 1),
          // three frames: 5, then +1, then -2, at a step of 1e0
          chunk(
            0x282,
            concat(
              new Uint8Array(Uint32Array.of(3).buffer),
              u16(1),
              u8(1, 0),
              floats(1, 5),
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
    const file = chunk(
      0x200,
      concat(
        header(2, false),
        chunk(0x202, concat(u16(0, 1, 1, 2, 1, 0), floats(0, 3))),
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
      modelCandidates('GUArcher_SKL', [
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
});
