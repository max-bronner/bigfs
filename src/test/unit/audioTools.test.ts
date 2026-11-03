import * as assert from 'assert';
import { toPlayableAudio } from '../../formats/audio/audioTools';

/** A RIFF/WAVE file with the given format fields and data */
const buildWave = (
  tag: number,
  channels: number,
  sampleRate: number,
  blockAlign: number,
  bitsPerSample: number,
  data: number[],
): Uint8Array => {
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  const writeTag = (at: number, text: string) =>
    bytes.set(
      Array.from(text, (c) => c.charCodeAt(0)),
      at,
    );

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + data.length, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, tag, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeTag(36, 'data');
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);

  return bytes;
};

suite('Audio decoding', () => {
  test('PCM plays as it is, with its duration', () => {
    const bytes = buildWave(1, 1, 8000, 2, 16, new Array(1600).fill(0));
    const { wav, info } = toPlayableAudio(bytes);

    assert.strictEqual(wav, bytes);
    assert.strictEqual(info.format, 'PCM');
    assert.strictEqual(info.durationSeconds, 0.1);
  });

  test('IMA ADPCM decodes to 16-bit PCM, starting from the block header', () => {
    // Mono, eight-byte blocks: a four-byte header (predictor 100, index 0)
    // then eight nibbles, so nine samples. The first nibble is 4: one step up.
    const bytes = buildWave(17, 1, 22050, 8, 4, [100, 0, 0, 0, 0x04, 0, 0, 0]);
    const { wav, info } = toPlayableAudio(bytes);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const samples = Array.from({ length: 9 }, (_, index) =>
      view.getInt16(44 + index * 2, true),
    );

    assert.strictEqual(info.format, 'IMA ADPCM');
    assert.strictEqual(view.getUint16(20, true), 1, 'rewritten as PCM');
    assert.deepStrictEqual(samples.slice(0, 3), [100, 107, 108]);
  });

  test('a data chunk claiming more than the file holds plays what is there', () => {
    const bytes = buildWave(1, 1, 8000, 2, 16, new Array(80).fill(0));

    new DataView(bytes.buffer).setUint32(40, 1_000_000, true);

    assert.strictEqual(toPlayableAudio(bytes).info.durationSeconds, 0.005);
  });

  test('a codec it does not decode is refused by number', () => {
    assert.throws(
      () => toPlayableAudio(buildWave(85, 2, 44100, 4, 16, [0, 0, 0, 0])),
      /codec 85 is not supported/,
    );
  });
});
