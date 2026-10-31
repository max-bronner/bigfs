import * as assert from 'assert';
import { growExtent } from '../../webview/apt/stageExtent';
import type { Rect } from '../../formats/apt/aptMovie';

suite('APT stage extent', () => {
  const screen: Rect = [0, 0, 1024, 768];
  const parked: Rect = [-1664, 0, 100, 100];

  test('a movie keeps its screen whatever it parks off it', () => {
    assert.deepStrictEqual(
      growExtent(screen, parked, { isScreen: true, isAnimating: false }),
      screen,
    );
  });

  test('a character does not widen while it plays', () => {
    assert.deepStrictEqual(
      growExtent(screen, parked, { isScreen: false, isAnimating: true }),
      screen,
    );
  });

  test('a still character widens to show the frame', () => {
    assert.deepStrictEqual(
      growExtent(screen, parked, { isScreen: false, isAnimating: false }),
      [-1664, 0, 1024, 768],
    );
  });
});
