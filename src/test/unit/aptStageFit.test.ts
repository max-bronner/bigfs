import * as assert from 'assert';
import { fitZoom, getFitSpace } from '../../webview/apt/stageFit';

suite('APT stage fit', () => {
  /** A page whose canvas sits in a wrapper that is only as wide as the canvas */
  const pageWith = (columnWidth: number, canvasWidth: number) => ({
    parentElement: { clientWidth: canvasWidth },
    closest: (selector: string) =>
      selector === 'main' ? { clientWidth: columnWidth } : null,
  });

  test('the room is the scrolling column, not the canvas wrapper', () => {
    const space = getFitSpace(pageWith(600, 53), 900);

    assert.strictEqual(space.width, 576);
    assert.strictEqual(space.height, 670);
  });

  test('fitting again at the size it produced keeps the zoom', () => {
    const extent = { width: 1024, height: 768 };
    let canvasWidth = 53;
    const zooms: number[] = [];

    for (let render = 0; render < 5; render++) {
      const zoom = fitZoom(getFitSpace(pageWith(600, canvasWidth), 900), extent, 16);

      zooms.push(zoom);
      canvasWidth = (extent.width + 32) * zoom;
    }
    assert.strictEqual(new Set(zooms).size, 1);
    assert.ok(zooms[0] > 0.5);
  });

  test('the zoom is held between the smallest and largest', () => {
    const space = { width: 600, height: 600 };

    assert.strictEqual(fitZoom(space, { width: 0, height: 0 }, 16), 4);
    assert.strictEqual(fitZoom(space, { width: 1e6, height: 1e6 }, 16), 0.05);
  });

  test('the tighter of width and height decides', () => {
    const space = { width: 1000, height: 400 };

    assert.strictEqual(fitZoom(space, { width: 468, height: 368 }, 16), 1);
  });
});
