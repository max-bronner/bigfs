/**
 * RefPack, EA's LZ77 variant, as SAGE maps carry it inside an `EAR\0`
 * wrapper. The decoder is ported from mint's `crates/sage/refpack`; the
 * encoder writes the same four command forms, so anything it makes the
 * decoder (and the game's) reads back.
 *
 * Header: a flags byte (0x80 four-byte sizes, 0x01 a compressed size
 * follows), `0xFB`, then the decompressed size big-endian. Commands:
 *
 * ```
 * 0x00-0x7F  2 bytes  0-3 literals, copy 3-10 bytes from up to 1,024 back
 * 0x80-0xBF  3 bytes  0-3 literals, copy 4-67 from up to 16,384 back
 * 0xC0-0xDF  4 bytes  0-3 literals, copy 5-1,028 from up to 131,072 back
 * 0xE0-0xFB  1 byte   4-112 literals
 * 0xFC-0xFF  1 byte   0-3 literals, then the end
 * ```
 */

/** Output is refused past this, whatever a header claims */
const MAX_OUTPUT = 256 * 1024 * 1024;

const EAR_MAGIC = [0x45, 0x41, 0x52, 0x00];

/** Whether bytes start with the `EAR\0` wrapper a compressed map has */
export const isEarWrapped = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 && EAR_MAGIC.every((byte, index) => bytes[index] === byte);

/** Decompresses a RefPack stream; throws on a malformed stream or one claiming more than 256 MiB */
export const decompressRefPack = (stream: Uint8Array): Uint8Array => {
  if (stream.length < 2 || stream[1] !== 0xfb) {
    throw new Error('Not a RefPack stream');
  }

  const width = stream[0] & 0x80 ? 4 : 3;
  let at = 2 + (stream[0] & 0x01 ? width : 0);
  let declared = 0;

  for (let index = 0; index < width; index++) {
    declared = declared * 256 + (stream[at + index] ?? 0);
  }

  at += width;

  if (declared > MAX_OUTPUT) {
    throw new Error(`RefPack claims ${declared} bytes, more than is allowed`);
  }

  const out = new Uint8Array(declared);
  let length = 0;
  const need = (count: number) => {
    if (at + count > stream.length) {
      throw new Error(`RefPack stream ends early at ${at}`);
    }
  };
  const literal = (count: number) => {
    need(count);

    if (length + count > out.length) {
      throw new Error('RefPack output runs past its declared size');
    }

    out.set(stream.subarray(at, at + count), length);
    at += count;
    length += count;
  };
  const copy = (distance: number, count: number) => {
    if (distance > length) {
      throw new Error(
        `RefPack copies from ${distance} back with ${length} written`,
      );
    }

    if (length + count > out.length) {
      throw new Error('RefPack output runs past its declared size');
    }

    for (let index = 0; index < count; index++, length++) {
      out[length] = out[length - distance];
    }
  };

  for (;;) {
    need(1);

    const op = stream[at++];

    if (op >= 0xfc) {
      literal(op & 3);
      break;
    }

    if (op >= 0xe0) {
      literal(((op & 0x1f) + 1) * 4);
    } else if (op >= 0xc0) {
      need(3);

      const [b1, b2, b3] = stream.subarray(at, at + 3);

      at += 3;
      literal(op & 3);
      copy(
        ((op & 0x10) << 12) + (b1 << 8) + b2 + 1,
        ((op & 0x0c) << 6) + b3 + 5,
      );
    } else if (op >= 0x80) {
      need(2);

      const [b1, b2] = stream.subarray(at, at + 2);

      at += 2;
      literal(b1 >> 6);
      copy(((b1 & 0x3f) << 8) + b2 + 1, (op & 0x3f) + 4);
    } else {
      need(1);

      const b1 = stream[at++];

      literal(op & 3);
      copy(((op & 0x60) << 3) + b1 + 1, ((op & 0x1c) >> 2) + 3);
    }
  }

  return length === out.length ? out : out.slice(0, length);
};

const WINDOW = 131072;
const MAX_MATCH = 1028;
const CHAIN = 48;

/** Compresses bytes into a RefPack stream, greedily with hash chains */
export const compressRefPack = (input: Uint8Array): Uint8Array => {
  const out: number[] = [];
  const size = input.length;

  if (size > 0xffffff) {
    out.push(
      0x80,
      0xfb,
      size >>> 24,
      (size >>> 16) & 255,
      (size >>> 8) & 255,
      size & 255,
    );
  } else {
    out.push(0x10, 0xfb, size >>> 16, (size >>> 8) & 255, size & 255);
  }

  const head = new Int32Array(1 << 16).fill(-1);
  const previous = new Int32Array(size).fill(-1);
  const hash = (at: number) =>
    ((input[at] << 8) ^ (input[at + 1] << 4) ^ input[at + 2]) & 0xffff;
  const insert = (at: number) => {
    if (at + 2 < size) {
      const key = hash(at);

      previous[at] = head[key];
      head[key] = at;
    }
  };
  let pending = 0;
  let position = 0;

  // Writes all but the last 0-3 pending literals as literal runs
  const flushRuns = () => {
    while (pending >= 4) {
      const run = Math.min(112, pending & ~3);
      const from = position - pending;

      out.push(0xe0 + run / 4 - 1);
      for (let index = 0; index < run; index++) {
        out.push(input[from + index]);
      }
      pending -= run;
    }
  };

  while (position < size) {
    let bestLength = 0;
    let bestDistance = 0;

    if (position + 2 < size) {
      let candidate = head[hash(position)];

      for (let steps = 0; candidate >= 0 && steps < CHAIN; steps++) {
        const distance = position - candidate;

        if (distance > WINDOW) {
          break;
        }

        let length = 0;
        const limit = Math.min(MAX_MATCH, size - position);

        while (
          length < limit &&
          input[candidate + length] === input[position + length]
        ) {
          length++;
        }

        const usable =
          length >= 5 ||
          (length >= 4 && distance <= 16384) ||
          (length >= 3 && distance <= 1024);

        if (usable && length > bestLength) {
          bestLength = length;
          bestDistance = distance;

          if (length === limit) {
            break;
          }
        }

        candidate = previous[candidate];
      }
    }

    if (!bestLength) {
      insert(position);
      position++;
      pending++;
      continue;
    }

    // Trim a long match to what its command form can carry
    if (bestDistance > 16384) {
      bestLength = Math.min(bestLength, 1028);
    } else if (bestDistance > 1024) {
      bestLength = Math.min(bestLength, bestLength >= 68 ? 1028 : 67);
    } else if (bestLength > 10 && bestLength < 68) {
      bestLength = Math.min(bestLength, 67);
    }

    flushRuns();

    const literals = pending;
    const from = position - literals;
    const distance = bestDistance - 1;

    if (bestLength <= 10 && bestDistance <= 1024) {
      out.push(
        ((distance >> 3) & 0x60) | ((bestLength - 3) << 2) | literals,
        distance & 255,
      );
    } else if (bestLength <= 67 && bestDistance <= 16384) {
      out.push(
        0x80 | (bestLength - 4),
        (literals << 6) | (distance >> 8),
        distance & 255,
      );
    } else {
      out.push(
        0xc0 |
          (((distance >> 16) & 1) << 4) |
          (((bestLength - 5) >> 8) << 2) |
          literals,
        (distance >> 8) & 255,
        distance & 255,
        (bestLength - 5) & 255,
      );
    }

    for (let index = 0; index < literals; index++) {
      out.push(input[from + index]);
    }
    pending = 0;

    for (let index = 0; index < bestLength; index++) {
      insert(position + index);
    }
    position += bestLength;
  }

  flushRuns();
  out.push(0xfc | pending);
  for (let index = position - pending; index < position; index++) {
    out.push(input[index]);
  }

  return Uint8Array.from(out);
};

/** Unwraps and decompresses an `EAR\0` file */
export const decompressEar = (bytes: Uint8Array): Uint8Array =>
  decompressRefPack(bytes.subarray(8));

/** Compresses into an `EAR\0` file */
export const compressEar = (body: Uint8Array): Uint8Array => {
  const stream = compressRefPack(body);
  const out = new Uint8Array(8 + stream.length);

  out.set(EAR_MAGIC);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(stream, 8);

  return out;
};
