import * as assert from 'assert';
import { planSeek } from '../../formats/vp6/planSeek';
import type { SeekFrame } from '../../formats/vp6/planSeek';
import { createFrameRequests } from '../../webview/preview/createFrameRequests';

const colourOnly = (keys: number[], count: number): SeekFrame[] =>
  Array.from({ length: count }, (_, index) => ({
    isKey: keys.includes(index),
  }));

suite('VP6 seeking', () => {
  test('a target just ahead is reached by decoding on', () => {
    assert.strictEqual(
      planSeek(colourOnly([0], 100), false, 10, 40),
      undefined,
    );
    assert.strictEqual(
      planSeek(colourOnly([0], 100), false, 10, 10),
      undefined,
    );
  });

  test('a target behind restarts at the key frame at or before it', () => {
    assert.deepStrictEqual(
      planSeek(colourOnly([0, 20, 50], 100), false, 80, 45),
      {
        start: 20,
        colourFrom: 20,
        alphaFrom: 20,
      },
    );
    assert.deepStrictEqual(
      planSeek(colourOnly([0, 20, 50], 100), false, 80, 50),
      {
        start: 50,
        colourFrom: 50,
        alphaFrom: 50,
      },
    );
  });

  test('a far target restarts only when a key frame lies past where decoding stands', () => {
    const frames = colourOnly([0, 90], 200);

    assert.deepStrictEqual(planSeek(frames, false, 10, 150), {
      start: 90,
      colourFrom: 90,
      alphaFrom: 90,
    });
    assert.strictEqual(
      planSeek(colourOnly([0], 200), false, 10, 150),
      undefined,
    );
  });

  test('alpha keys independently, and the restart is at the earlier key', () => {
    const frames: SeekFrame[] = Array.from({ length: 12 }, (_, index) => ({
      isKey: index % 6 === 0,
      alpha: new Uint8Array(1),
      // Alpha keys at 0, 3 and 9
      isAlphaKey: index % 3 === 0 && index % 6 !== 0 ? true : index === 0,
    }));

    assert.deepStrictEqual(planSeek(frames, true, 11, 7), {
      start: 3,
      colourFrom: 6,
      alphaFrom: 3,
    });
    assert.deepStrictEqual(planSeek(frames, true, 11, 5), {
      start: 0,
      colourFrom: 0,
      alphaFrom: 3,
    });
  });
});

suite('Frame requests', () => {
  test('a ask during one in flight waits, and only the newest is sent when it returns', () => {
    const sent: number[] = [];
    const requests = createFrameRequests((index) => sent.push(index));

    requests.want(5);
    requests.want(9);
    requests.want(12);
    requests.want(7);
    assert.deepStrictEqual(sent, [5]);

    requests.settle();
    assert.deepStrictEqual(sent, [5, 7]);

    requests.settle();
    assert.deepStrictEqual(sent, [5, 7]);
  });

  test('a failed frame frees the next ask', () => {
    const sent: number[] = [];
    const requests = createFrameRequests((index) => sent.push(index));

    requests.want(1);
    requests.settle();
    requests.want(2);
    assert.deepStrictEqual(sent, [1, 2]);
  });
});
