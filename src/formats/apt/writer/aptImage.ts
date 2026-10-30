/**
 * Edits an APT movie without moving anything that is not edited.
 *
 * The file is a memory image whose pointers are absolute offsets, so every
 * record stays where it is: a fixed-size field is overwritten in place, and
 * anything new, from a renamed string to an added character, is appended at
 * the end with the one pointer that leads to it updated. A movie saved with
 * no edits is byte-identical to the one read, and an edited one differs only
 * in the fields edited and the bytes appended.
 */

/** An `.apt` image that grows at its end */
export class AptImage {
  private data: Uint8Array;
  private view: DataView;
  private size: number;

  public constructor(bytes: Uint8Array) {
    this.data = new Uint8Array(Math.max(64, bytes.length * 2));
    this.data.set(bytes);
    this.size = bytes.length;
    this.view = new DataView(this.data.buffer);
  }

  /** The length of the image as it stands */
  public get length(): number {
    return this.size;
  }

  /** A copy of the image as it stands */
  public get bytes(): Uint8Array {
    return this.data.slice(0, this.size);
  }

  private reserve(length: number, align = 4): number {
    const at = (this.size + align - 1) & ~(align - 1);

    if (at + length > this.data.length) {
      const grown = new Uint8Array(
        Math.max(this.data.length * 2, at + length + 1024),
      );

      grown.set(this.data.subarray(0, this.size));
      this.data = grown;
      this.view = new DataView(this.data.buffer);
    }

    this.data.fill(0, this.size, at + length);
    this.size = at + length;

    return at;
  }

  private check(offset: number, length: number): void {
    if (offset < 0 || offset + length > this.size) {
      throw new Error(
        `Write of ${length} bytes at ${offset} is outside the movie`,
      );
    }
  }

  /** Reads an unsigned 32-bit word at an offset inside the image */
  public u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  /** Overwrites an unsigned 32-bit word in place */
  public setU32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setUint32(offset, value >>> 0, true);
  }

  /** Overwrites a signed 32-bit word in place */
  public setI32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setInt32(offset, value, true);
  }

  /** Overwrites a 32-bit float in place */
  public setF32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setFloat32(offset, value, true);
  }

  /** Appends a NUL-terminated Latin-1 string and returns its offset */
  public appendString(text: string): number {
    if (/[^\x00-\xff]/.test(text) || text.includes('\0')) {
      throw new Error(
        'A movie string holds Latin-1 characters only, without NUL',
      );
    }

    const at = this.reserve(text.length + 1, 1);

    for (let index = 0; index < text.length; index++) {
      this.data[at + index] = text.charCodeAt(index);
    }

    return at;
  }

  /** Appends words, aligned to four bytes, and returns their offset */
  public appendWords(words: number[]): number {
    const at = this.reserve(words.length * 4);

    words.forEach((word, index) =>
      this.view.setUint32(at + index * 4, word >>> 0, true),
    );

    return at;
  }

  /** Appends a copy of existing bytes, aligned to four, and returns its offset */
  public appendCopy(offset: number, length: number): number {
    this.check(offset, length);

    const copy = this.data.slice(offset, offset + length);
    const at = this.reserve(length);

    this.data.set(copy, at);

    return at;
  }

  /** Appends raw bytes at an alignment, and returns their offset */
  public appendBytes(bytes: Uint8Array, align = 4): number {
    const at = this.reserve(bytes.length, align);

    this.data.set(bytes, at);

    return at;
  }

  /**
   * Moves an array of words to the end with room for `extra` more, points
   * `pointerAt` at the copy and returns its offset
   */
  public growArray(pointerAt: number, count: number, extra: number): number {
    const from = this.u32(pointerAt);
    const words = Array.from({ length: count }, (_, index) =>
      this.u32(from + index * 4),
    );
    const at = this.appendWords([...words, ...new Array(extra).fill(0)]);

    this.setU32(pointerAt, at);

    return at;
  }
}
