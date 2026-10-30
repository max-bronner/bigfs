/**
 * The two entropy readers of VP6 and its Huffman trees, ported from mint's
 * `crates/core/vp6` (`bits.rs`, `bool_decoder.rs`, `huffman.rs`), which
 * ported them from NihAV via Ruffle (MIT; see `THIRD-PARTY-NOTICES.md`).
 */

/** Reads past the end of a stream a frame may make before it counts as truncated */
export const MAX_OVERRUN = 16;

/** Bit reader for VP6's Huffman-coded partitions, most significant bit first */
export class BitReader {
  private byte = 0;
  private bit = 0;

  public constructor(private readonly src: Uint8Array) {}

  private nextBit(): number | undefined {
    if (this.byte >= this.src.length) {
      return undefined;
    }

    const value = (this.src[this.byte] >> (7 - this.bit)) & 1;

    if (this.bit === 7) {
      this.bit = 0;
      this.byte++;
    } else {
      this.bit++;
    }

    return value;
  }

  /** Reads `count` bits as an unsigned number; throws once the stream runs out */
  public read(count: number): number {
    let value = 0;

    for (let index = 0; index < count; index++) {
      const bit = this.nextBit();

      if (bit === undefined) {
        throw new Error('VP6 frame truncated: bit reader');
      }

      value = ((value << 1) | bit) >>> 0;
    }

    return value;
  }

  /** Reads one bit as a flag */
  public readBool(): boolean {
    return this.read(1) !== 0;
  }

  /** Reads the next 16 bits without consuming them, padding past the end with zeros */
  public peek16(): number {
    const saved = [this.byte, this.bit];
    let value = 0;

    for (let index = 0; index < 16; index++) {
      value = (value << 1) | (this.nextBit() ?? 0);
    }

    [this.byte, this.bit] = saved;

    return value;
  }

  /** Consumes `count` bits */
  public skip(count: number): void {
    this.read(count);
  }

  /** Whole bytes consumed so far */
  public get bytesRead(): number {
    return this.byte;
  }
}

/** VP6's arithmetic decoder of binary decisions */
export class BoolDecoder {
  private pos = 4;
  private value = 0;
  private range = 255;
  private bits = 8;
  /** Bytes read past the end of the stream, compared against `MAX_OVERRUN` */
  public overrun = 0;

  public constructor(private readonly src: Uint8Array) {
    for (let index = 0; index < 4; index++) {
      if (index >= src.length) {
        this.overrun++;
      }

      this.value = ((this.value << 8) | (src[index] ?? 0)) >>> 0;
    }
  }

  /** Reads one decision whose chance of being false is `prob` / 256 */
  public readProb(prob: number): boolean {
    this.renorm();

    const split = (((this.range - 1) * prob) >>> 8) + 1;
    const bound = (split << 24) >>> 0;

    if (this.value < bound) {
      this.range = split;

      return false;
    }

    this.range -= split;
    this.value = (this.value - bound) >>> 0;

    return true;
  }

  /** Reads one even-odds decision */
  public readBool(): boolean {
    return this.readProb(128);
  }

  /** Reads `count` even-odds decisions as an unsigned number, most significant first */
  public readBits(count: number): number {
    let value = 0;

    for (let index = 0; index < count; index++) {
      value = ((value << 1) | (this.readProb(128) ? 1 : 0)) >>> 0;
    }

    return value;
  }

  /** Reads a 7-bit probability, doubled, never zero */
  public readProbability(): number {
    const value = this.readBits(7);

    return value === 0 ? 1 : (value << 1) & 255;
  }

  private renorm(): void {
    const shift = Math.clz32(this.range) & 7;

    this.range = (this.range << shift) >>> 0;
    this.value = (this.value << shift) >>> 0;
    this.bits -= shift;

    if (this.bits <= 0) {
      if (this.pos < this.src.length) {
        this.value = (this.value | (this.src[this.pos] << -this.bits)) >>> 0;
        this.pos++;
      } else {
        this.overrun++;
      }

      this.bits += 8;
    }
  }
}

/** Reads one branch of a VP6 tree: `a` when the decision is false, `b` when it is true */
export const tree = <T>(
  bc: BoolDecoder,
  prob: number,
  a: () => T,
  b: () => T,
): T => (bc.readProb(prob) ? b() : a());

const MAX_ELEMS = 12;

interface Node {
  weight: number;
  sym?: number;
  ch0: number;
  ch1: number;
}

/** `a * b >> 8`, at least 1 */
const weight = (a: number, b: number) =>
  Math.max(1, Math.min(255, (a * b) >> 8));

const not = (value: number) => ~value & 255;

/** Huffman code built from token or zero-run probabilities, for frames coded with Huffman */
export class Huff {
  private readonly codes = new Uint16Array(MAX_ELEMS);
  private readonly bits = new Uint8Array(MAX_ELEMS);

  /** Creates the code for DC or AC tokens from their bool-coder probabilities */
  public static fromTokenProbs(p: readonly number[]): Huff {
    const w = new Array<number>(12).fill(0);

    w[11] = weight(p[0], p[1]);
    w[0] = weight(p[0], not(p[1]));
    w[1] = weight(not(p[0]), p[2]);

    const lvroot = weight(not(p[0]), not(p[2]));
    const tworoot = weight(lvroot, p[3]);
    const hlroot = weight(lvroot, not(p[3]));

    w[2] = weight(tworoot, p[4]);

    const root34 = weight(tworoot, not(p[4]));

    w[3] = weight(root34, p[5]);
    w[4] = weight(root34, not(p[5]));

    const c1root = weight(hlroot, p[6]);
    const c34root = weight(hlroot, not(p[6]));

    w[5] = weight(c1root, p[7]);
    w[6] = weight(c1root, not(p[7]));

    const c3root = weight(c34root, p[8]);
    const c4root = weight(c34root, not(p[8]));

    w[7] = weight(c3root, p[9]);
    w[8] = weight(c3root, not(p[9]));
    w[9] = weight(c4root, p[10]);
    w[10] = weight(c4root, not(p[10]));

    return Huff.build(w);
  }

  /** Creates the code for zero runs from their bool-coder probabilities */
  public static fromZeroRunProbs(p: readonly number[]): Huff {
    const w = new Array<number>(9).fill(0);
    let root = weight(p[0], p[1]);

    w[0] = weight(root, p[2]);
    w[1] = weight(root, not(p[2]));
    root = weight(p[0], not(p[1]));
    w[2] = weight(root, p[3]);
    w[3] = weight(root, not(p[3]));
    root = weight(not(p[0]), p[4]);
    w[8] = weight(not(p[0]), not(p[4]));

    const root1 = weight(root, p[5]);
    const root2 = weight(root, not(p[5]));

    w[4] = weight(root1, p[6]);
    w[5] = weight(root1, not(p[6]));
    w[6] = weight(root2, p[7]);
    w[7] = weight(root2, not(p[7]));

    return Huff.build(w);
  }

  private static build(weights: number[]): Huff {
    const nodes: Node[] = [];

    // Leaves sorted by weight, the higher symbol first among equals
    for (let sym = weights.length - 1; sym >= 0; sym--) {
      const position = nodes.findIndex((node) => node.weight > weights[sym]);

      nodes.splice(position < 0 ? nodes.length : position, 0, {
        weight: weights[sym],
        sym,
        ch0: 0,
        ch1: 0,
      });
    }

    const leaves = nodes.length;
    let low = 0;

    for (let index = 1; index < leaves; index++) {
      const a = nodes[low];
      const b = nodes[low + 1];
      const parent: Node = {
        weight: a.weight + b.weight,
        ch0: low,
        ch1: low + 1,
      };

      low += 2;

      let position = nodes
        .slice(low)
        .findIndex((node) => node.weight >= parent.weight);

      position = position < 0 ? nodes.length : position + low;
      nodes.splice(position, 0, parent);

      // Children below the insertion point moved; their indices did not
    }

    const huff = new Huff();
    const stack: [number, number, number][] = [[nodes.length - 1, 0, 0]];

    while (stack.length) {
      const [position, code, length] = stack.pop() as [number, number, number];
      const node = nodes[position];

      if (!node) {
        throw new Error('VP6 frame data invalid: Huffman tree');
      }

      if (node.sym !== undefined) {
        huff.codes[node.sym] = code;
        huff.bits[node.sym] = length;
      } else {
        stack.push(
          [node.ch1, (code << 1) | 1, length + 1],
          [node.ch0, code << 1, length + 1],
        );
      }
    }

    for (let index = nodes.length; index < MAX_ELEMS; index++) {
      huff.codes[index] = huff.codes[0];
      huff.bits[index] = huff.bits[0];
    }

    return huff;
  }

  /** Reads one symbol */
  public read(br: BitReader): number {
    const peek = br.peek16();

    for (let sym = 0; sym < MAX_ELEMS; sym++) {
      if (peek >>> (16 - this.bits[sym]) === this.codes[sym]) {
        br.skip(this.bits[sym]);

        return sym;
      }
    }

    throw new Error('VP6 frame data invalid: Huffman code');
  }
}
