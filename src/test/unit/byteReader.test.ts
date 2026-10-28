import * as assert from 'assert';
import { ByteReaderOverrunError, createByteReader } from '../../core/byteReader';

suite('Byte reader', () => {
  test('reads little-endian numbers by default', () => {
    const reader = createByteReader(
      new Uint8Array([1, 2, 1, 4, 3, 2, 1, 0xff, 0xff, 0xff, 0xff, 0, 0, 0x80, 0x3f]),
    );
    assert.strictEqual(reader.u8(), 1);
    assert.strictEqual(reader.u16(), 0x0102);
    assert.strictEqual(reader.u32(), 0x01020304);
    assert.strictEqual(reader.i32(), -1);
    assert.strictEqual(reader.f32(), 1);
    assert.strictEqual(reader.remaining, 0);
  });

  test('reads big-endian numbers on request', () => {
    const reader = createByteReader(new Uint8Array([1, 2, 1, 2, 3, 4, 0x3f, 0x80, 0, 0]), false);
    assert.strictEqual(reader.u16(), 0x0102);
    assert.strictEqual(reader.u32(), 0x01020304);
    assert.strictEqual(reader.f32(), 1);
  });

  test('respects the byte offset of a view into a larger buffer', () => {
    const buffer = new Uint8Array([9, 9, 7, 8]);
    const reader = createByteReader(buffer.subarray(2));
    assert.strictEqual(reader.remaining, 2);
    assert.strictEqual(reader.u16(), 0x0807);
  });

  test('bytes copies instead of aliasing the source', () => {
    const source = new Uint8Array([1, 2, 3]);
    const copy = createByteReader(source).bytes(2);
    source[0] = 99;
    assert.deepStrictEqual(Array.from(copy), [1, 2]);
  });

  test('reads strings', () => {
    const reader = createByteReader(new Uint8Array([0x68, 0x69, 0, 0x42, 0x49, 0x47, 0x46, 0xe9, 0]));
    assert.strictEqual(reader.cstring(), 'hi');
    assert.strictEqual(reader.ascii(4), 'BIGF');
    assert.strictEqual(reader.cstring(), 'é');
    assert.strictEqual(reader.remaining, 0);
  });

  test('seek and skip move the cursor and may land on the end', () => {
    const reader = createByteReader(new Uint8Array([1, 2, 3, 4]));
    reader.skip(3);
    assert.strictEqual(reader.offset, 3);
    assert.strictEqual(reader.u8(), 4);
    reader.seek(1);
    assert.strictEqual(reader.u8(), 2);
    reader.seek(4);
    assert.strictEqual(reader.remaining, 0);
  });

  test('an overrun throws a typed error carrying the offset and leaves the cursor', () => {
    const reader = createByteReader(new Uint8Array([1, 2, 3]));
    reader.u8();
    assert.throws(
      () => reader.u32(),
      (error: unknown) =>
        error instanceof ByteReaderOverrunError &&
        error.offset === 1 &&
        error.requested === 4 &&
        error.length === 3,
    );
    assert.strictEqual(reader.offset, 1);
    assert.throws(() => reader.bytes(3), ByteReaderOverrunError);
    assert.throws(() => reader.ascii(3), ByteReaderOverrunError);
    assert.throws(() => reader.skip(3), ByteReaderOverrunError);
  });

  test('refuses nonsense lengths and seeks', () => {
    const reader = createByteReader(new Uint8Array([1, 2]));
    assert.throws(() => reader.bytes(-1), ByteReaderOverrunError);
    assert.throws(() => reader.bytes(Number.NaN), ByteReaderOverrunError);
    assert.throws(() => reader.seek(3), ByteReaderOverrunError);
    assert.throws(() => reader.seek(-1), ByteReaderOverrunError);
  });

  test('an unterminated cstring throws', () => {
    const reader = createByteReader(new Uint8Array([0x61, 0x62]));
    assert.throws(() => reader.cstring(), ByteReaderOverrunError);
    assert.strictEqual(reader.offset, 0);
  });
});
