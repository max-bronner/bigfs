import * as assert from 'assert';
import { MIN_FIT_SCALE, getFitScale } from '../../webview/preview/getFitScale';
import {
  MAX_BITMAP_SIDE,
  getOverlayWindow,
} from '../../webview/preview/getOverlayWindow';

suite('Texture fit and region overlay', () => {
  test('fit keeps a texture whole in the room it has, in both directions', () => {
    const texture = { width: 1024, height: 512 };

    assert.strictEqual(getFitScale({ width: 512, height: 900 }, texture), 0.5);
    assert.strictEqual(getFitScale({ width: 2000, height: 128 }, texture), 0.25);
    assert.strictEqual(getFitScale({ width: 4000, height: 4000 }, texture), 1);
    assert.strictEqual(
      getFitScale({ width: 0, height: 0 }, texture),
      MIN_FIT_SCALE,
    );
  });

  test('the overlay covers what is on screen at every zoom and pixel ratio', () => {
    for (const scale of [0.25, 0.8, 3.3, 32]) {
      for (const pixelRatio of [1, 1.25, 1.5, 2]) {
        const texture = { width: 1024 * scale, height: 512 * scale };
        const visible = {
          left: texture.width * 0.4,
          top: texture.height * 0.3,
          width: Math.min(700, texture.width),
          height: Math.min(500, texture.height),
        };
        const placed = getOverlayWindow(texture, visible, pixelRatio);
        const shownWidth = placed.bitmapWidth / placed.pixelRatio;
        const shownHeight = placed.bitmapHeight / placed.pixelRatio;
        const label = `zoom ${scale} ratio ${pixelRatio}`;

        assert.ok(placed.left <= visible.left + 1e-9, label);
        assert.ok(placed.top <= visible.top + 1e-9, label);
        assert.ok(
          placed.left + shownWidth >=
            Math.min(visible.left + visible.width, texture.width) - 1e-9,
          label,
        );
        assert.ok(
          placed.top + shownHeight >=
            Math.min(visible.top + visible.height, texture.height) - 1e-9,
          label,
        );
        assert.ok(placed.bitmapWidth <= MAX_BITMAP_SIDE, label);
        assert.ok(placed.bitmapHeight <= MAX_BITMAP_SIDE, label);
      }
    }
  });

  test('a texture zoomed far past what a canvas holds keeps a small bitmap', () => {
    const texture = { width: 1024 * 32, height: 1024 * 32 };
    const placed = getOverlayWindow(
      texture,
      { left: 10000, top: 20000, width: 1200, height: 900 },
      2,
    );

    assert.strictEqual(placed.bitmapWidth, 2400);
    assert.strictEqual(placed.bitmapHeight, 1800);
    assert.strictEqual(placed.left, 10000);
    assert.strictEqual(placed.top, 20000);
  });

  test('a view scrolled past the texture is held inside it', () => {
    const placed = getOverlayWindow(
      { width: 300, height: 200 },
      { left: 5000, top: -40, width: 400, height: 400 },
      1,
    );

    assert.ok(placed.left <= 300);
    assert.strictEqual(placed.top, 0);
    assert.ok(placed.bitmapHeight <= 200);
  });
});
