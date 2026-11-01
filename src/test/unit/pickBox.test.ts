import * as assert from 'assert';
import { getResizeScale } from '../../webview/shared/getResizeScale';
import { pickBox } from '../../webview/shared/pickBox';
import type { Box } from '../../webview/shared/pickBox';

const box: Box = [10, 10, 30, 20];

suite('box handles', () => {
  test('a press near a corner grabs it with the opposite corner as anchor', () => {
    assert.deepStrictEqual(pickBox(box, [31, 19], 3), {
      anchor: [10, 10],
      handle: [30, 20],
    });
  });

  test('a press inside the box moves it and one outside grabs nothing', () => {
    assert.strictEqual(pickBox(box, [20, 15], 3), 'move');
    assert.strictEqual(pickBox(box, [50, 50], 3), undefined);
  });

  test('a corner drag scales about the anchor, uniformly when asked', () => {
    const grab = { anchor: [10, 10] as [number, number], handle: [30, 20] as [number, number] };

    assert.deepStrictEqual(getResizeScale(grab, [50, 15], false), [2, 0.5]);
    assert.deepStrictEqual(getResizeScale(grab, [50, 15], true), [2, 2]);
  });
});
