import * as assert from 'assert';
import { decodeWindows1252, encodeWindows1252 } from '../../core/windows1252';

suite('Windows-1252', () => {
  test('bytes 0x80-0x9F decode to the characters the encoding gives them', () => {
    assert.strictEqual(
      decodeWindows1252(Uint8Array.of(0x80, 0x92, 0x93)),
      '€’“',
    );
    assert.strictEqual(decodeWindows1252(Uint8Array.of(0x81)), '\u0081');
    assert.strictEqual(decodeWindows1252(Uint8Array.of(0x41, 0xe9)), 'Aé');
  });

  test('every byte survives a round trip', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);

    assert.deepStrictEqual(encodeWindows1252(decodeWindows1252(bytes)), bytes);
  });

  test('plain ASCII longer than a decoding chunk keeps every character, control bytes included', () => {
    const bytes = Uint8Array.from(
      { length: 0x8000 * 2 + 5 },
      (_, index) => index % 128,
    );
    const expected = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

    assert.strictEqual(decodeWindows1252(bytes), expected);
  });

  test('one high byte after a long ASCII run still decodes through the table', () => {
    const bytes = new Uint8Array(0x8000 + 2).fill(0x61);

    bytes[bytes.length - 1] = 0x92;

    assert.strictEqual(
      decodeWindows1252(bytes),
      `${'a'.repeat(0x8000 + 1)}’`,
    );
  });

  test('a character the encoding lacks throws, or takes the replacement', () => {
    assert.throws(() => encodeWindows1252('日'), /Windows-1252/);
    assert.deepStrictEqual(
      encodeWindows1252('a日', 0x3f),
      Uint8Array.of(0x61, 0x3f),
    );
  });
});
