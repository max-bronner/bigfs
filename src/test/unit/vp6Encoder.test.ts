import * as assert from 'assert';
import { Vp6Movie, parseVp6, writeVp6 } from '../../formats/vp6/container';
import { encodeMovie } from '../../formats/vp6/encodeMovie';
import { Vp6Encoder, pictureFromRgba } from '../../formats/vp6/encoder';

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
  test('a movie it writes, key and inter frames, reads back close to the source with its rate and alpha', async () => {
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

    // After the first, frames predict from the one before
    assert.deepStrictEqual(
      parseVp6(bytes!).frames.map((each) => each.isKey),
      [true, false, false, false],
    );

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

  test('seeking in a movie whose alpha key frames are not at its colour key frames equals playing through', () => {
    const [width, height, count] = [32, 16, 12];
    const colour = new Vp6Encoder({ quality: 54 });
    const alpha = new Vp6Encoder({ quality: 54 });
    const frames = [];

    for (let index = 0; index < count; index++) {
      const rgba = frame(width, height, index * 9);
      // Colour keys at 0 and 6, alpha keys at 0 and 3 and 9
      const colourKey = colour.encode(
        pictureFromRgba(rgba, width, height),
        index % 6 === 0,
      );
      const alphaKey = alpha.encode(
        pictureFromRgba(rgba, width, height, true),
        index % 3 === 0 && index % 6 !== 0 ? true : index === 0,
      );

      frames.push({
        colour: colourKey.data,
        isKey: colourKey.isKey,
        alpha: alphaKey.data,
        isAlphaKey: alphaKey.isKey,
      });
    }

    const bytes = writeVp6({
      width,
      height,
      rateNumerator: 15,
      rateDenominator: 1,
      frames,
    });
    const played = new Vp6Movie(bytes);
    const expected: Uint8ClampedArray[] = [];

    for (let index = 0; index < count; index++) {
      expected.push(played.frame(index));
    }

    // Colour restarts at 6 but alpha's key before it is 3
    const seeker = new Vp6Movie(bytes);

    assert.deepStrictEqual(seeker.frame(count - 1), expected[count - 1]);
    assert.deepStrictEqual(seeker.frame(7), expected[7]);
  });

  test('an empty file says so', () => {
    assert.throws(() => new Vp6Movie(new Uint8Array(0)), /empty/);
  });
});
