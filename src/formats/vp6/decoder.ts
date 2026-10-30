import { BitReader, BoolDecoder, Huff, MAX_OVERRUN, tree } from './coders';
import { Filter, Mv, Picture, addBlock, mcBlock, putBlock } from './dsp';
import { CoeffModel, Models, MvModel } from './models';
import {
  DcPredictor,
  MbType,
  Ref,
  ZERO_MV,
  mvCandidates,
  referenceOf,
} from './prediction';
import type { MvCandidates } from './prediction';
import * as T from './tables';

/**
 * An On2 VP6 decoder (VP6.0-6.2, simple and advanced profiles, bool-coded
 * and Huffman-coded coefficients), ported from mint's
 * `crates/core/vp6/src/{header,decoder}.rs`, which port NihAV's decoder as
 * relicensed under MIT for Ruffle (see `THIRD-PARTY-NOTICES.md`).
 *
 * `decode` takes one compressed frame and returns its planes at the coded
 * size; cropping and the bottom-up row order of EA's movies are the
 * caller's.
 */

const TOKEN_LARGE = 5;
const TOKEN_EOB = 42;
const PROFILE_SIMPLE = 0;
const PROFILE_ADVANCED = 3;

export { MbType, Ref, referenceOf } from './prediction';

/** Slot of each macroblock mode in the mode probability tables, which order them differently */
export const MODEL_INDEX: Record<MbType, number> = {
  [MbType.InterNoMv]: 0,
  [MbType.Intra]: 1,
  [MbType.InterMv]: 2,
  [MbType.InterNearest]: 3,
  [MbType.InterNear]: 4,
  [MbType.GoldenNoMv]: 5,
  [MbType.GoldenMv]: 6,
  [MbType.InterFourMv]: 7,
  [MbType.GoldenNearest]: 8,
  [MbType.GoldenNear]: 9,
};

const i16 = (value: number) => (value << 16) >> 16;
const addMv = (a: Mv, b: Mv): Mv => ({ x: i16(a.x + b.x), y: i16(a.y + b.y) });

interface Header {
  isIntra: boolean;
  isGolden: boolean;
  quant: number;
  multistream: boolean;
  useHuffman: boolean;
  interlaced: boolean;
  offset: number;
  mbWidth: number;
  mbHeight: number;
}

interface StreamState {
  version: number;
  profile: number;
  interlaced: boolean;
  doPm: boolean;
  autoselPm: boolean;
  varThresh: number;
  mvThresh: number;
  bicubic: boolean;
  filterAlpha: number;
  loopFilter: boolean;
}

const parseHeader = (
  src: Uint8Array,
  st: StreamState,
): [Header, BoolDecoder] => {
  const br = new BitReader(src);
  const isIntra = !br.readBool();
  const quant = br.read(6);
  let multistream = br.readBool();
  let version: number;
  let profile: number;
  let interlaced: boolean;

  if (isIntra) {
    version = br.read(5);

    if (version < 6 || version > 8) {
      throw new Error(
        `VP6 bitstream version ${version} is not supported (6 to 8)`,
      );
    }

    profile = br.read(2);

    if (profile !== PROFILE_SIMPLE && profile !== PROFILE_ADVANCED) {
      throw new Error(`VP6 profile ${profile} is not supported (0 or 3)`);
    }

    interlaced = br.readBool();
  } else if (st.version === 0) {
    throw new Error('VP6 inter frame without a preceding key frame');
  } else {
    [version, profile, interlaced] = [st.version, st.profile, st.interlaced];
  }

  let offset = 0;

  if (multistream || profile === PROFILE_SIMPLE) {
    offset = br.read(16);

    if (offset <= (isIntra ? 6 : 2)) {
      throw new Error('VP6 frame header invalid: coefficient partition offset');
    }

    multistream = true;
  }

  const bc = new BoolDecoder(src.subarray(br.bytesRead));
  const header: Header = {
    isIntra,
    isGolden: isIntra,
    quant,
    multistream,
    useHuffman: false,
    interlaced,
    offset,
    mbWidth: 0,
    mbHeight: 0,
  };

  st.loopFilter = false;

  if (isIntra) {
    header.mbHeight = bc.readBits(8);
    header.mbWidth = bc.readBits(8);
    bc.readBits(8);
    bc.readBits(8);

    if (!header.mbWidth || !header.mbHeight) {
      throw new Error('VP6 frame header invalid: zero macroblock dimension');
    }

    bc.readBits(2);
  } else {
    header.isGolden = bc.readBool();

    if (profile === PROFILE_ADVANCED) {
      st.loopFilter = bc.readBool();

      if (st.loopFilter && bc.readBool()) {
        throw new Error('VP6 frame header invalid: loop filter type');
      }

      if (version === 8) {
        st.doPm = bc.readBool();
      }
    }
  }

  if (profile === PROFILE_ADVANCED && (isIntra || st.doPm)) {
    st.autoselPm = bc.readBool();

    if (st.autoselPm) {
      st.varThresh = bc.readBits(5);

      if (version !== 8) {
        st.varThresh = (st.varThresh << 5) & 0xffff;
      }

      st.mvThresh = bc.readBits(3);
    } else {
      st.bicubic = bc.readBool();
    }

    st.filterAlpha = version === 8 ? bc.readBits(4) : 16;
  }

  header.useHuffman = bc.readBool();
  st.version = version;
  st.profile = profile;
  st.interlaced = interlaced;

  return [header, bc];
};

interface MbInfo {
  type: MbType;
  mv: Mv;
}

interface BlockState {
  coeffCat: number[];
  lastIdx: number[];
  dcQuant: number;
  acQuant: number;
  dcZeroRun: number[];
  acZeroRun: number[];
}

type CoeffReader =
  | { kind: 'main' }
  | { kind: 'bool'; bc: BoolDecoder }
  | { kind: 'huff'; br: BitReader };

/** Stateful VP6 decoder for one stream, holding the reference pictures between frames */
export class Vp6Decoder {
  private st: StreamState = {
    version: 0,
    profile: 0,
    interlaced: false,
    doPm: false,
    autoselPm: false,
    varThresh: 0,
    mvThresh: 0,
    bicubic: false,
    filterAlpha: 0,
    loopFilter: false,
  };
  private mbWidth = 0;
  private mbHeight = 0;
  private models = new Models();
  private mbInfo: MbInfo[] = [];
  private dcPred = new DcPredictor();
  private topCtx: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array(0),
    new Uint8Array(0),
  ];
  private coeffs = Array.from({ length: 6 }, () => new Int16Array(64));
  private lastMbt = MbType.InterNoMv;
  private ilaceProb = 0;
  private ilaceMb = false;
  private blk: BlockState = {
    coeffCat: [0, 0, 0, 0],
    lastIdx: [0, 0, 0, 0],
    dcQuant: 0,
    acQuant: 0,
    dcZeroRun: [0, 0],
    acZeroRun: [0, 0],
  };
  private filter!: Filter;
  private work = new Picture(0, 0);
  private last?: Picture;
  private golden?: Picture;

  /** Decodes one frame; the picture returned is reused by later calls */
  public decode(frame: Uint8Array): Picture {
    const [header, bc] = parseHeader(frame, this.st);

    if (header.multistream && header.offset >= frame.length) {
      throw new Error(
        'VP6 frame truncated: coefficient partition offset past the frame',
      );
    }

    if (header.isIntra) {
      this.last = undefined;
      this.golden = undefined;

      if (
        header.mbWidth !== this.mbWidth ||
        header.mbHeight !== this.mbHeight ||
        this.work.width === 0
      ) {
        this.setDimensions(header.mbWidth, header.mbHeight);
      }
    } else if (!this.last) {
      throw new Error('VP6 inter frame without a preceding key frame');
    }

    const work = this.work;

    this.decodePlanes(work, frame, bc, header);

    if (header.isGolden) {
      this.golden = work.clone();
    }

    const previous = this.last;

    this.last = work;
    this.work = previous ?? new Picture(this.mbWidth, this.mbHeight);

    return work;
  }

  private setDimensions(mbWidth: number, mbHeight: number): void {
    this.mbWidth = mbWidth;
    this.mbHeight = mbHeight;
    this.mbInfo = Array.from({ length: mbWidth * mbHeight }, () => ({
      type: MbType.InterNoMv,
      mv: ZERO_MV,
    }));
    this.topCtx = [
      new Uint8Array(mbWidth * 2),
      new Uint8Array(mbWidth),
      new Uint8Array(mbWidth),
    ];
    this.dcPred.resize(mbWidth);
    this.work = new Picture(mbWidth, mbHeight);
  }

  private decodePlanes(
    frame: Picture,
    src: Uint8Array,
    bc: BoolDecoder,
    header: Header,
  ): void {
    let reader: CoeffReader = { kind: 'main' };

    if (header.multistream) {
      const part = src.subarray(header.offset);

      reader = header.useHuffman
        ? { kind: 'huff', br: new BitReader(part) }
        : { kind: 'bool', bc: new BoolDecoder(part) };
    }

    if (header.isIntra) {
      this.models.reset(this.st.interlaced);
    } else {
      this.models.decodeModeProbs(bc);
      this.models.decodeMvModels(bc);
    }

    this.models.decodeCoeffModels(bc, header.isIntra, this.st.interlaced);

    if (header.useHuffman) {
      this.models.buildHuffman();
    }

    if (header.interlaced) {
      this.ilaceProb = bc.readBits(8);
    }

    const q = header.quant;

    this.blk = {
      coeffCat: [0, 0, 0, 0],
      lastIdx: [0, 0, 0, 0],
      dcQuant: i16((T.VP56_DC_QUANTS[q] ?? 0) * 4),
      acQuant: i16((T.VP56_AC_QUANTS[q] ?? 0) * 4),
      dcZeroRun: [0, 0],
      acZeroRun: [0, 0],
    };
    this.filter = {
      advanced: this.st.profile === PROFILE_ADVANCED,
      autosel: this.st.autoselPm,
      varThresh: this.st.varThresh,
      mvThresh: this.st.mvThresh,
      bicubic: this.st.bicubic,
      filterAlpha: this.st.filterAlpha,
      loopThr: T.VP56_FILTER_LIMITS[q] ?? 0,
      deblock: this.st.loopFilter,
    };
    this.lastMbt = MbType.InterNoMv;
    this.topCtx.forEach((ctx) => ctx.fill(0));
    this.dcPred.reset();
    this.ilaceMb = false;

    for (let mbY = 0; mbY < this.mbHeight; mbY++) {
      this.blk.coeffCat = [0, 0, 0, 0];
      this.blk.lastIdx = [24, 24, 24, 24];

      for (let mbX = 0; mbX < this.mbWidth; mbX++) {
        this.decodeMb(frame, bc, reader, header, mbX, mbY);
        this.dcPred.nextMb();

        const coeffOverrun = reader.kind === 'bool' ? reader.bc.overrun : 0;

        if (bc.overrun > MAX_OVERRUN || coeffOverrun > MAX_OVERRUN) {
          throw new Error('VP6 frame truncated: bool-coded data ran out');
        }
      }

      this.dcPred.newRow();
    }
  }

  private findMvPred(mbX: number, mbY: number, want: Ref): MvCandidates {
    return mvCandidates(
      (index) => this.mbInfo[index],
      mbX,
      mbY,
      this.mbWidth,
      this.mbHeight,
      want,
    );
  }

  private decodeMv(bc: BoolDecoder): Mv {
    return {
      x: decodeMvComponent(bc, this.models.mv[0]),
      y: decodeMvComponent(bc, this.models.mv[1]),
    };
  }

  private decodeMbType(bc: BoolDecoder, ctx: number): MbType {
    const probs =
      this.models.mbtype[ctx]?.[MODEL_INDEX[this.lastMbt]] ??
      new Array(10).fill(128);

    if (!bc.readProb(probs[9])) {
      this.lastMbt = tree(
        bc,
        probs[0],
        () =>
          tree(
            bc,
            probs[1],
            () =>
              tree(
                bc,
                probs[3],
                () => MbType.InterNoMv,
                () => MbType.InterMv,
              ),
            () =>
              tree(
                bc,
                probs[4],
                () => MbType.InterNearest,
                () => MbType.InterNear,
              ),
          ),
        () =>
          tree(
            bc,
            probs[2],
            () =>
              tree(
                bc,
                probs[5],
                () => MbType.Intra,
                () => MbType.InterFourMv,
              ),
            () =>
              tree(
                bc,
                probs[6],
                () =>
                  tree(
                    bc,
                    probs[7],
                    () => MbType.GoldenNoMv,
                    () => MbType.GoldenMv,
                  ),
                () =>
                  tree(
                    bc,
                    probs[8],
                    () => MbType.GoldenNearest,
                    () => MbType.GoldenNear,
                  ),
              ),
          ),
      );
    }

    return this.lastMbt;
  }

  private decodeMb(
    frame: Picture,
    bc: BoolDecoder,
    reader: CoeffReader,
    header: Header,
    mbX: number,
    mbY: number,
  ): void {
    const FOUR_MV_SUB = [
      MbType.InterNoMv,
      MbType.InterMv,
      MbType.InterNearest,
      MbType.InterNear,
    ];

    this.coeffs.forEach((block) => block.fill(0));

    const mbPos = mbY * this.mbWidth + mbX;
    let fourMv: Mv[] = [ZERO_MV, ZERO_MV, ZERO_MV, ZERO_MV];

    if (header.interlaced) {
      const ip = this.ilaceProb;
      const prob =
        mbX === 0
          ? ip
          : !this.ilaceMb
            ? (ip + ((256 - ip) >> 1)) & 255
            : ip - (ip >> 1);

      this.ilaceMb = bc.readProb(prob);
    }

    const { count, nearest, near, pred } = header.isIntra
      ? { count: 0, nearest: ZERO_MV, near: ZERO_MV, pred: ZERO_MV }
      : this.findMvPred(mbX, mbY, Ref.Previous);
    const type = header.isIntra
      ? MbType.Intra
      : this.decodeMbType(bc, (count + 1) % 3);
    let mv: Mv;

    switch (type) {
      case MbType.Intra:
      case MbType.InterNoMv:
        mv = ZERO_MV;
        break;
      case MbType.InterMv:
        mv = addMv(pred, this.decodeMv(bc));
        break;
      case MbType.InterNearest:
        mv = nearest;
        break;
      case MbType.InterNear:
        mv = near;
        break;
      case MbType.InterFourMv: {
        const sub = [0, 1, 2, 3].map(
          () => FOUR_MV_SUB[bc.readBits(2)] ?? MbType.InterNoMv,
        );

        fourMv = sub.map((subType) =>
          subType === MbType.InterMv
            ? addMv(pred, this.decodeMv(bc))
            : subType === MbType.InterNearest
              ? nearest
              : subType === MbType.InterNear
                ? near
                : ZERO_MV,
        );
        mv = fourMv[3];
        break;
      }
      default: {
        const {
          nearest: goldNearest,
          near: goldNear,
          pred: goldPred,
        } = this.findMvPred(mbX, mbY, Ref.Golden);

        mv =
          type === MbType.GoldenMv
            ? addMv(goldPred, this.decodeMv(bc))
            : type === MbType.GoldenNearest
              ? goldNearest
              : type === MbType.GoldenNear
                ? goldNear
                : ZERO_MV;
      }
    }

    this.mbInfo[mbPos] = { type, mv };

    const reference = referenceOf(type);

    if (reference !== Ref.Intra) {
      const source = reference === Ref.Golden ? this.golden : this.last;

      if (!source) {
        throw new Error('VP6 inter frame without a preceding key frame');
      }

      predictMb(frame, source, mbX, mbY, type, mv, fourMv, this.filter);
    }

    for (let blockNo = 0; blockNo < 6; blockNo++) {
      const luma = blockNo < 4;
      const plane = luma ? 0 : blockNo - 3;
      const ctxIdx = luma ? blockNo >> 1 : blockNo - 2;
      const topPos = luma ? mbX * 2 + (blockNo & 1) : mbX;
      const topCtx = this.topCtx[plane][topPos] ?? 0;
      const model = this.models.coeff[luma ? 0 : 1];
      const coeffs = this.coeffs[blockNo];
      let newTop: number;

      if (reader.kind === 'huff') {
        decodeBlockHuff(
          reader.br,
          coeffs,
          this.models,
          this.blk,
          ctxIdx,
          luma ? 0 : 1,
        );
        newTop = topCtx;
      } else {
        newTop = decodeBlock(
          reader.kind === 'bool' ? reader.bc : bc,
          coeffs,
          model,
          this.models.zigzag,
          this.models.zeroRunProbs,
          this.blk,
          ctxIdx,
          topCtx,
        );
      }

      this.topCtx[plane][topPos] = newTop;
      this.predictDc(type, blockNo);

      const hasAc = (this.blk.lastIdx[ctxIdx] ?? 0) > 0;
      const [bx, by] = luma
        ? [mbX * 2 + (blockNo & 1), mbY * 2 + (blockNo >> 1)]
        : [mbX, mbY];
      const isField = luma && this.ilaceMb;
      const dcOnly = !hasAc && !isField;

      if (type === MbType.Intra) {
        putBlock(coeffs, dcOnly, frame.planes[plane], bx, by, isField);
      } else {
        addBlock(coeffs, dcOnly, frame.planes[plane], bx, by, isField);
      }
    }
  }

  private predictDc(type: MbType, blockNo: number): void {
    const reference = referenceOf(type);
    const coeffs = this.coeffs[blockNo];
    const dc = i16(coeffs[0] + this.dcPred.predict(blockNo, reference));

    this.dcPred.update(blockNo, reference, dc);
    coeffs[0] = i16(Math.imul(dc, this.blk.dcQuant));
  }
}

/**
 * Predicts an inter macroblock into `frame` from the reference picture `src`.
 * A four-vector macroblock gives chroma the average of its four vectors.
 */
export const predictMb = (
  frame: Picture,
  src: Picture,
  mbX: number,
  mbY: number,
  type: MbType,
  mv: Mv,
  fourMv: Mv[],
  filter: Filter,
) => {
  const x = mbX * 16;
  const y = mbY * 16;
  let chromaMv = mv;

  if (type === MbType.InterFourMv) {
    fourMv.forEach((blockMv, block) =>
      mcBlock(
        frame.planes[0],
        src.planes[0],
        x + (block & 1) * 8,
        y + (block & 2) * 4,
        blockMv,
        true,
        filter,
      ),
    );

    const sum = fourMv.reduce(addMv, ZERO_MV);

    chromaMv = { x: Math.trunc(sum.x / 4), y: Math.trunc(sum.y / 4) };
  } else {
    for (const [bx, by] of [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ]) {
      mcBlock(frame.planes[0], src.planes[0], x + bx, y + by, mv, true, filter);
    }
  }

  mcBlock(
    frame.planes[1],
    src.planes[1],
    mbX * 8,
    mbY * 8,
    chromaMv,
    false,
    filter,
  );
  mcBlock(
    frame.planes[2],
    src.planes[2],
    mbX * 8,
    mbY * 8,
    chromaMv,
    false,
    filter,
  );
};

const decodeMvComponent = (bc: BoolDecoder, model: MvModel): number => {
  const tp = model.treeProbs;
  let value: number;

  if (!bc.readProb(model.nzProb)) {
    value = tree(
      bc,
      tp[0],
      () =>
        tree(
          bc,
          tp[1],
          () =>
            tree(
              bc,
              tp[2],
              () => 0,
              () => 1,
            ),
          () =>
            tree(
              bc,
              tp[3],
              () => 2,
              () => 3,
            ),
        ),
      () =>
        tree(
          bc,
          tp[4],
          () =>
            tree(
              bc,
              tp[5],
              () => 4,
              () => 5,
            ),
          () =>
            tree(
              bc,
              tp[6],
              () => 6,
              () => 7,
            ),
        ),
    );
  } else {
    let raw = 0;

    for (const bit of T.LONG_VECTOR_ORDER) {
      raw |= (bc.readProb(model.rawProbs[bit] ?? 128) ? 1 : 0) << bit;
    }

    if (raw & 0xf0) {
      raw |= (bc.readProb(model.rawProbs[3]) ? 1 : 0) << 3;
    } else {
      raw |= 1 << 3;
    }

    value = i16(raw);
  }

  return value !== 0 && bc.readProb(model.signProb) ? i16(-value) : value;
};

const expandToken = (
  bc: BoolDecoder,
  valProbs: readonly number[],
  token: number,
): number => {
  let level: number;

  if (token < TOKEN_LARGE) {
    level = token;
  } else {
    const category = tree(
      bc,
      valProbs[6],
      () =>
        tree(
          bc,
          valProbs[7],
          () => 0,
          () => 1,
        ),
      () =>
        tree(
          bc,
          valProbs[8],
          () =>
            tree(
              bc,
              valProbs[9],
              () => 2,
              () => 3,
            ),
          () =>
            tree(
              bc,
              valProbs[10],
              () => 4,
              () => 5,
            ),
        ),
    );
    let add = 0;

    for (const prob of T.VP56_COEF_ADD_PROBS[category] ?? []) {
      if (prob === 128) {
        break;
      }

      add = i16((add << 1) | (bc.readProb(prob) ? 1 : 0));
    }

    level = i16((T.VP56_COEF_BASE[category] ?? 0) + add);
  }

  return token !== 0 && bc.readBool() ? i16(-level) : level;
};

const decodeToken = (
  bc: BoolDecoder,
  probs: readonly number[],
  isDc: boolean,
  hasNnz: boolean,
): number => {
  if (hasNnz && !bc.readProb(probs[0])) {
    return isDc || bc.readProb(probs[1]) ? 0 : TOKEN_EOB;
  }

  return tree(
    bc,
    probs[2],
    () => 1,
    () =>
      tree(
        bc,
        probs[3],
        () =>
          tree(
            bc,
            probs[4],
            () => 2,
            () =>
              tree(
                bc,
                probs[5],
                () => 3,
                () => 4,
              ),
          ),
        () => TOKEN_LARGE,
      ),
  );
};

const decodeZeroRun = (bc: BoolDecoder, probs: readonly number[]): number => {
  const value = tree(
    bc,
    probs[0],
    () =>
      tree(
        bc,
        probs[1],
        () =>
          tree(
            bc,
            probs[2],
            () => 0,
            () => 1,
          ),
        () =>
          tree(
            bc,
            probs[3],
            () => 2,
            () => 3,
          ),
      ),
    () =>
      tree(
        bc,
        probs[4],
        () =>
          tree(
            bc,
            probs[5],
            () =>
              tree(
                bc,
                probs[6],
                () => 4,
                () => 5,
              ),
            () =>
              tree(
                bc,
                probs[7],
                () => 6,
                () => 7,
              ),
          ),
        () => 42,
      ),
  );

  if (value !== 42) {
    return value;
  }

  let run = 8;

  for (let index = 8; index < probs.length; index++) {
    run += (bc.readProb(probs[index]) ? 1 : 0) << (index - 8);
  }

  return run;
};

const decodeBlock = (
  bc: BoolDecoder,
  coeffs: Int16Array,
  model: CoeffModel,
  zigzag: number[],
  zeroRunProbs: number[][],
  blk: BlockState,
  ctxIdx: number,
  topCtx: number,
): number => {
  const leftCtx = blk.coeffCat[ctxIdx];
  const dcProbs = model.dcTokenProbs[topCtx + leftCtx];

  if (!dcProbs) {
    throw new Error('VP6 frame data invalid: coefficient context');
  }

  const probs = [...dcProbs, ...model.dcValueProbs.slice(5)];
  const token = decodeToken(bc, probs, true, true);
  const value = expandToken(bc, model.dcValueProbs, token);

  coeffs[0] = value;

  let index = 1;
  let lastValue = value;

  while (index < 64) {
    const band = T.VP6_IDX_TO_AC_BAND[index] ?? 5;
    const mode = Math.min(Math.abs(lastValue), 2);
    const acProbs = model.acValProbs[mode][band];
    const next = decodeToken(
      bc,
      acProbs,
      false,
      index === 1 || lastValue !== 0,
    );

    if (next === TOKEN_EOB) {
      break;
    }

    const nextValue = expandToken(bc, acProbs, next);

    coeffs[zigzag[index] ?? 0] = i16(Math.imul(nextValue, blk.acQuant));
    index++;
    lastValue = nextValue;

    if (nextValue === 0) {
      index += decodeZeroRun(bc, zeroRunProbs[index >= 7 ? 1 : 0]);

      if (index > 64) {
        throw new Error('VP6 frame data invalid: zero run past the block end');
      }
    }
  }

  const category = coeffs[0] !== 0 ? 1 : 0;

  blk.coeffCat[ctxIdx] = category;
  blk.lastIdx[ctxIdx] = index;

  return category;
};

/** Reads a Huffman-coded token's value, or `undefined` at the end of the block */
const decodeTokenHuff = (br: BitReader, huff: Huff): number | undefined => {
  const token = huff.read(br);

  if (token === 0) {
    return 0;
  }

  let value: number;

  if (token <= 4) {
    value = token;
  } else if (token <= 10) {
    const base = token - 5;

    value = i16(
      (T.VP56_COEF_BASE[base] ?? 0) + br.read(T.VP6_COEF_ADD_BITS[base] ?? 0),
    );
  } else {
    return undefined;
  }

  return br.readBool() ? i16(-value) : value;
};

const decodeEobRunHuff = (br: BitReader): number => {
  switch (br.read(2)) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return br.read(2) + 2;
    default:
      return br.readBool() ? br.read(6) + 10 : br.read(2) + 6;
  }
};

const decodeBlockHuff = (
  br: BitReader,
  coeffs: Int16Array,
  models: Models,
  blk: BlockState,
  ctxIdx: number,
  plane: number,
): void => {
  let lastValue = 0;

  if (blk.dcZeroRun[plane] === 0) {
    const value = decodeTokenHuff(br, models.huff.dc[plane]);

    if (value === undefined) {
      return;
    }

    lastValue = value;
    coeffs[0] = value;

    if (value === 0) {
      blk.dcZeroRun[plane] = decodeEobRunHuff(br);
    }
  } else {
    blk.dcZeroRun[plane] -= 1;
  }

  if (blk.acZeroRun[plane] > 0) {
    blk.acZeroRun[plane] -= 1;
    blk.lastIdx[ctxIdx] = 0;

    return;
  }

  const trees = models.huff.ac[plane];
  let index = 1;

  while (index < 64) {
    const band = Math.min(T.VP6_IDX_TO_AC_BAND[index] ?? 5, 3);
    const mode = Math.min(Math.abs(lastValue), 2);
    const value = decodeTokenHuff(br, trees[mode][band]);

    if (value === undefined) {
      if (index === 1) {
        blk.acZeroRun[plane] = decodeEobRunHuff(br);
      }
      break;
    }

    coeffs[models.zigzag[index] ?? 0] = i16(Math.imul(value, blk.acQuant));
    index++;
    lastValue = value;

    if (value === 0) {
      const symbol = models.huff.zeroRun[index >= 7 ? 1 : 0].read(br);

      index += symbol < 8 ? symbol : br.read(6) + 8;

      if (index > 64) {
        throw new Error('VP6 frame data invalid: zero run past the block end');
      }
    }
  }

  blk.lastIdx[ctxIdx] = index;
};
