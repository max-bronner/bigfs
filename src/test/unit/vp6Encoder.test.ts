import * as assert from 'assert';
import { Vp6Movie } from '../../formats/vp6/container';
import { encodeMovie } from '../../formats/vp6/encodeMovie';

/** A picture with edges, gradients and transparency, odd-sized */
const frame = (width: number, height: number, shift: number) => {
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;

      rgba[at] = (x * 3 + shift) & 255;
      rgba[at + 1] = y * 4;
      rgba[at + 2] = x > width / 2 ? 220 : 30;
      rgba[at + 3] = Math.min(255, x * 5);
    }
  }
  return rgba;
};

const psnr = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  channels: number[],
) => {
  let error = 0;
  let count = 0;

  for (let at = 0; at < a.length; at += 4) {
    for (const channel of channels) {
      error += (a[at + channel] - b[at + channel]) ** 2;
      count++;
    }
  }
  return 10 * Math.log10((255 * 255) / (error / count));
};

suite('VP6 encoder', () => {
  test('a movie it writes reads back with its frames, rate and alpha, close to the source', async () => {
    const [width, height] = [70, 38];
    let next = 0;
    const bytes = await encodeMovie(
      {
        width,
        height,
        rateNumerator: 30000,
        rateDenominator: 1001,
        alpha: true,
        next: async () =>
          next < 4 ? frame(width, height, next++ * 9) : undefined,
      },
      { quality: 54 },
    );
    const movie = new Vp6Movie(bytes!);

    assert.strictEqual(movie.frameCount, 4);
    assert.strictEqual(movie.hasAlpha, true);
    assert.ok(Math.abs(movie.framesPerSecond - 29.97) < 0.01);
    for (let index = 0; index < 4; index++) {
      const source = frame(width, height, index * 9);
      const shown = movie.frame(index);

      assert.ok(psnr(source, shown, [0, 1, 2]) > 32, `frame ${index} colour`);
      assert.ok(psnr(source, shown, [3]) > 38, `frame ${index} alpha`);
    }
  });
});
