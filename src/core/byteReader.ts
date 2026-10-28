/** Thrown when a read or seek would pass either end of the bytes */
export class ByteReaderOverrunError extends Error {
  constructor(
    readonly offset: number,
    readonly requested: number,
    readonly length: number,
  ) {
    super(`Read of ${requested} bytes at offset ${offset} overruns the ${length} bytes available`);
    this.name = 'ByteReaderOverrunError';
  }
}

/** A cursor over bytes that reads fixed-width numbers and strings in one byte order */
export interface ByteReader {
  /** Offset of the next read from the start of the bytes */
  readonly offset: number;
  /** Count of bytes after the cursor */
  readonly remaining: number;
  u8(): number;
  u16(): number;
  u32(): number;
  i32(): number;
  f32(): number;
  /** Copies the next `length` bytes */
  bytes(length: number): Uint8Array;
  /** Reads up to the next zero byte and steps over it; the bytes are Latin-1 */
  cstring(): string;
  /** Reads exactly `length` bytes as Latin-1 */
  ascii(length: number): string;
  /** Moves the cursor to an absolute offset, which may be the end */
  seek(offset: number): void;
  /** Moves the cursor forward by `length` bytes */
  skip(length: number): void;
}

/**
 * Creates a reader over `bytes`, little-endian unless `littleEndian` is false.
 * Every read is bounded by the bytes present and throws `ByteReaderOverrunError`
 * instead of returning partial data.
 */
export const createByteReader = (bytes: Uint8Array, littleEndian = true): ByteReader => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const claim = (length: number): number => {
    if (!Number.isInteger(length) || length < 0 || length > bytes.byteLength - offset) {
      throw new ByteReaderOverrunError(offset, length, bytes.byteLength);
    }
    const start = offset;
    offset += length;
    return start;
  };

  const latin1 = (start: number, length: number): string => {
    let text = '';
    for (let index = start; index < start + length; index++) {
      text += String.fromCharCode(bytes[index]);
    }
    return text;
  };

  return {
    get offset() {
      return offset;
    },
    get remaining() {
      return bytes.byteLength - offset;
    },
    u8: () => view.getUint8(claim(1)),
    u16: () => view.getUint16(claim(2), littleEndian),
    u32: () => view.getUint32(claim(4), littleEndian),
    i32: () => view.getInt32(claim(4), littleEndian),
    f32: () => view.getFloat32(claim(4), littleEndian),
    bytes: (length) => {
      const start = claim(length);
      return bytes.slice(start, start + length);
    },
    cstring: () => {
      const end = bytes.indexOf(0, offset);
      if (end === -1) {
        throw new ByteReaderOverrunError(offset, bytes.byteLength - offset + 1, bytes.byteLength);
      }
      const start = offset;
      offset = end + 1;
      return latin1(start, end - start);
    },
    ascii: (length) => latin1(claim(length), length),
    seek: (target) => {
      if (!Number.isInteger(target) || target < 0 || target > bytes.byteLength) {
        throw new ByteReaderOverrunError(target, 0, bytes.byteLength);
      }
      offset = target;
    },
    skip: (length) => {
      claim(length);
    },
  };
};
