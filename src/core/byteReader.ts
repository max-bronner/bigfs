/** Thrown when a read or seek would pass either end of the bytes */
export class ByteReaderOverrunError extends Error {
  constructor(
    readonly offset: number,
    readonly requested: number,
    readonly length: number,
    message = `Read of ${requested} bytes at offset ${offset} overruns the ${length} bytes available`,
  ) {
    super(message);
    this.name = 'ByteReaderOverrunError';
  }
}

/** A cursor over bytes that reads fixed-width numbers and strings in one byte order */
export interface ByteReader {
  /** Offset of the next read from the start of the bytes */
  readonly offset: number;
  /** Count of bytes after the cursor */
  readonly remaining: number;
  /** Reads an unsigned 8-bit integer */
  u8(): number;
  /** Reads an unsigned 16-bit integer */
  u16(): number;
  /** Reads an unsigned 32-bit integer */
  u32(): number;
  /** Reads a signed 32-bit integer */
  i32(): number;
  /** Reads a 32-bit float */
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

/** Narrows a reader to part of its bytes, or words the error a format shows for an overrun */
export interface ByteReaderOptions {
  /** Offset of the first readable byte, which is also where the cursor starts; 0 by default */
  start?: number;
  /** Offset after the last readable byte; the length of the bytes by default */
  end?: number;
  /** The message of the `ByteReaderOverrunError`, for a format whose users see its own wording */
  describeOverrun?: (offset: number, requested: number, length: number) => string;
}

/**
 * Creates a reader over `bytes`, little-endian unless `littleEndian` is false.
 * Every read is bounded by the bytes present, or by `options.end`, and throws
 * `ByteReaderOverrunError` instead of returning partial data. Offsets always
 * count from the start of `bytes`, whatever `options.start` is.
 */
export const createByteReader = (
  bytes: Uint8Array,
  littleEndian = true,
  options: ByteReaderOptions = {},
): ByteReader => {
  const { start: first = 0, describeOverrun } = options;
  const end = Math.min(options.end ?? bytes.byteLength, bytes.byteLength);
  const overrun = (at: number, requested: number) =>
    new ByteReaderOverrunError(at, requested, end, describeOverrun?.(at, requested, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = first;

  const claim = (length: number): number => {
    if (!Number.isInteger(length) || length < 0 || length > end - offset) {
      throw overrun(offset, length);
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
      return end - offset;
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
      const terminator = bytes.subarray(0, end).indexOf(0, offset);
      if (terminator === -1) {
        throw overrun(offset, end - offset + 1);
      }
      const start = offset;
      offset = terminator + 1;
      return latin1(start, terminator - start);
    },
    ascii: (length) => latin1(claim(length), length),
    seek: (target) => {
      if (!Number.isInteger(target) || target < first || target > end) {
        throw overrun(target, 0);
      }
      offset = target;
    },
    skip: (length) => {
      claim(length);
    },
  };
};
