/**
 * Builds synthetic APT movies for tests, byte by byte, since no shipped file
 * may be committed. Offsets are absolute in the `.apt`, as in the real
 * format; `reserve` hands out space to fill once a pointer is known.
 */
export class Image {
  private bytes: number[] = [];

  /** The current end, where the next write lands */
  public get end(): number {
    return this.bytes.length;
  }

  public align(): number {
    while (this.bytes.length % 4) {
      this.bytes.push(0);
    }

    return this.bytes.length;
  }

  public u8(...values: number[]): number {
    const at = this.end;

    values.forEach((value) => this.bytes.push(value & 255));

    return at;
  }

  public u32(...values: number[]): number {
    const at = this.end;

    for (const value of values) {
      const word = new Uint8Array(new Uint32Array([value >>> 0]).buffer);

      this.bytes.push(...word);
    }

    return at;
  }

  public f32(...values: number[]): number {
    const at = this.end;

    for (const value of values) {
      this.bytes.push(...new Uint8Array(new Float32Array([value]).buffer));
    }

    return at;
  }

  public string(text: string): number {
    const at = this.end;

    this.bytes.push(...Array.from(text, (char) => char.charCodeAt(0)), 0);

    return at;
  }

  /** Overwrites a word written earlier */
  public patch(at: number, value: number): void {
    new Uint8Array(new Uint32Array([value >>> 0]).buffer).forEach(
      (byte, index) => {
        this.bytes[at + index] = byte;
      },
    );
  }

  public build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** A `.const` file with the movie offset and the given items */
export const buildConst = (
  movieOffset: number,
  items: (string | number)[],
): Uint8Array => {
  const file = new Image();

  file.u8(...Array.from('Apt constant file\x1a\0\0', (c) => c.charCodeAt(0)));
  file.u32(movieOffset, items.length, 0x20);

  const slots = items.map((item) =>
    typeof item === 'string' ? file.u32(1, 0) : file.u32(4, item),
  );

  items.forEach((item, index) => {
    if (typeof item === 'string') {
      file.patch(slots[index] + 4, file.string(item));
    }
  });

  return file.build();
};
