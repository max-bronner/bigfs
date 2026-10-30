import { BoolDecoder, HuffmanCode, readBranch } from './coders';
import * as T from './tables';

/**
 * VP6's adaptive probability models, ported from mint's
 * `crates/core/vp6/src/models.rs` (NihAV via Ruffle, MIT).
 */

/** Motion vector probabilities for one component, horizontal or vertical */
export interface MvModel {
  nzProb: number;
  signProb: number;
  rawProbs: number[];
  treeProbs: number[];
}

/** Coefficient token probabilities for one plane group, luma or chroma */
export interface CoeffModel {
  dcTokenProbs: number[][];
  dcValueProbs: number[];
  /** By the previous value's magnitude (0, 1, 2+), then band */
  acValProbs: number[][][];
}

const newCoeffModel = (): CoeffModel => ({
  dcTokenProbs: [
    new Array(5).fill(0),
    new Array(5).fill(0),
    new Array(5).fill(0),
  ],
  dcValueProbs: new Array(11).fill(0),
  acValProbs: Array.from({ length: 3 }, () =>
    Array.from({ length: 6 }, () => new Array(11).fill(0)),
  ),
});

const rescaleModeProb = (prob: number, total: number) => {
  const value = Math.floor((255 * prob) / (total + 1));

  return Math.min(255, value);
};

const rescaleProb = (prob: number, weights: readonly number[]) =>
  Math.max(1, Math.min(255, ((prob * weights[0] + 128) >> 8) + weights[1]));

/** Adaptive probability state a VP6 decoder or encoder carries from frame to frame */
export class Models {
  public mv: MvModel[] = [0, 1].map(() => ({
    nzProb: 0,
    signProb: 0,
    rawProbs: new Array(8).fill(0),
    treeProbs: new Array(7).fill(0),
  }));
  /** Macroblock type probabilities by context, then previous mode */
  public mbtype: number[][][] = Array.from({ length: 3 }, () =>
    Array.from({ length: 10 }, () => new Array(10).fill(0)),
  );
  public coeff: CoeffModel[] = [newCoeffModel(), newCoeffModel()];
  private probXmitted: number[][] = Array.from({ length: 3 }, () =>
    new Array(20).fill(0),
  );
  private scanOrder: number[] = new Array(64).fill(0);
  public zigzag: number[] = [...T.ZIGZAG];
  public zeroRunProbs: number[][] = [
    new Array(14).fill(0),
    new Array(14).fill(0),
  ];
  public huff = {
    dc: [] as HuffmanCode[],
    ac: [] as HuffmanCode[][][],
    zeroRun: [] as HuffmanCode[],
  };

  /** Restores the default probabilities and scan order, as every intra frame does */
  public reset(interlaced: boolean): void {
    this.mv.forEach((model, index) => {
      model.nzProb = T.NZ_PROBS[index];
      model.signProb = 128;
      model.rawProbs = [...T.RAW_PROBS[index]];
      model.treeProbs = [...T.TREE_PROBS[index]];
    });
    this.zeroRunProbs = T.ZERO_RUN_PROBS.map((row) => [...row]);
    this.resetScan(interlaced);
    this.probXmitted = T.DEFAULT_XMITTED_PROBS.map((row) => [...row]);
  }

  private resetScan(interlaced: boolean): void {
    this.scanOrder = [
      ...(interlaced ? T.VP6_INTERLACED_SCAN_ORDER : T.VP6_DEFAULT_SCAN_ORDER),
    ];
    this.zigzag = [...T.ZIGZAG];
  }

  private updateScan(): void {
    const scan = new Array<number>(64).fill(0);
    let index = 1;

    for (let band = 0; band < 16; band++) {
      for (let position = 1; position < 64; position++) {
        if (this.scanOrder[position] === band) {
          if (index < 64) {
            scan[index] = position;
          }
          index++;
        }
      }
    }

    for (let position = 1; position < 64; position++) {
      this.zigzag[position] = T.ZIGZAG[scan[position]] ?? 0;
    }
  }

  /** Reads the macroblock mode probability updates of a frame header, then recomputes `mbtype` */
  public decodeModeProbs(bc: BoolDecoder): void {
    for (let ctx = 0; ctx < 3; ctx++) {
      const px = this.probXmitted[ctx];

      if (bc.readProb(174)) {
        const vq = T.VP56_MODE_VQ[ctx]?.[bc.readBits(4)];

        if (!vq) {
          throw new Error('VP6 frame data invalid: mode vector');
        }

        vq.forEach((value, index) => {
          px[index ^ 1] = value;
        });
      }

      if (bc.readProb(254)) {
        for (let set = 0; set < 20; set++) {
          if (!bc.readProb(205)) {
            continue;
          }

          const sign = bc.readBool();
          const diff =
            readBranch(
              bc,
              171,
              () =>
                readBranch(
                  bc,
                  83,
                  () => 2,
                  () => 1,
                ),
              () =>
                readBranch(
                  bc,
                  199,
                  () =>
                    readBranch(
                      bc,
                      140,
                      () =>
                        readBranch(
                          bc,
                          125,
                          () =>
                            readBranch(
                              bc,
                              104,
                              () => 6,
                              () => 5,
                            ),
                          () => 4,
                        ),
                      () => 3,
                    ),
                  () => bc.readBits(7),
                ),
            ) * 4;

          if (diff > 255) {
            throw new Error('VP6 frame data invalid: mode delta');
          }

          const next = sign ? px[set ^ 1] - diff : px[set ^ 1] + diff;

          if (next < 0 || next > 255) {
            throw new Error('VP6 frame data invalid: mode delta');
          }

          px[set ^ 1] = next;
        }
      }
    }

    this.computeModeProbs();
  }

  /** Derives the macroblock type probabilities from the transmitted pairs */
  public computeModeProbs(): void {
    this.probXmitted.forEach((px, ctx) => {
      this.mbtype[ctx].forEach((probs, mode) => {
        const p = (index: number) => px[index] ?? 0;
        const cnt = new Array<number>(10).fill(0);
        let total = 0;

        for (let index = 0; index < 10; index++) {
          if (index !== mode) {
            cnt[index] = p(index * 2) * 100;
            total += cnt[index];
          }
        }

        const sum = p(mode * 2) + p(mode * 2 + 1);

        probs[9] = 255 - rescaleModeProb(p(mode * 2 + 1), sum);

        const interMv0 = cnt[0] + cnt[2];
        const interMv1 = cnt[3] + cnt[4];
        const goldMv0 = cnt[5] + cnt[6];
        const goldMv1 = cnt[8] + cnt[9];
        const mix = cnt[1] + cnt[7];
        const r = (a: number, b: number) =>
          Math.min(255, rescaleModeProb(a, b) + 1);

        probs[0] = r(interMv0 + interMv1, total);
        probs[1] = r(interMv0, interMv0 + interMv1);
        probs[2] = r(mix, mix + goldMv0 + goldMv1);
        probs[3] = r(cnt[0], interMv0);
        probs[4] = r(cnt[3], interMv1);
        probs[5] = r(cnt[1], mix);
        probs[6] = r(goldMv0, goldMv0 + goldMv1);
        probs[7] = r(cnt[5], goldMv0);
        probs[8] = r(cnt[8], goldMv1);
      });
    });
  }

  /** Reads the motion vector probability updates of a frame header */
  public decodeMvModels(bc: BoolDecoder): void {
    this.mv.forEach((model, index) => {
      if (bc.readProb(T.HAS_NZ_PROB[index])) {
        model.nzProb = bc.readProbability();
      }

      if (bc.readProb(T.HAS_SIGN_PROB[index])) {
        model.signProb = bc.readProbability();
      }
    });
    this.mv.forEach((model, index) => {
      T.HAS_TREE_PROB[index].forEach((has, slot) => {
        if (bc.readProb(has)) {
          model.treeProbs[slot] = bc.readProbability();
        }
      });
    });
    this.mv.forEach((model, index) => {
      T.HAS_RAW_PROB[index].forEach((has, slot) => {
        if (bc.readProb(has)) {
          model.rawProbs[slot] = bc.readProbability();
        }
      });
    });
  }

  /**
   * Reads the coefficient, scan order and zero-run probability updates of a
   * frame header. An intra frame sets every slot it does not update to the default.
   */
  public decodeCoeffModels(
    bc: BoolDecoder,
    isIntra: boolean,
    interlaced: boolean,
  ): void {
    // One default per slot, carried from model to model as the format has it
    const defProb = new Array<number>(11).fill(128);

    this.coeff.forEach((model, index) => {
      T.HAS_COEF_PROBS[index].forEach((has, slot) => {
        if (bc.readProb(has)) {
          defProb[slot] = bc.readProbability();
          model.dcValueProbs[slot] = defProb[slot];
        } else if (isIntra) {
          model.dcValueProbs[slot] = defProb[slot];
        }
      });
    });

    if (bc.readBool()) {
      for (let position = 1; position < 64; position++) {
        if (bc.readProb(T.HAS_SCAN_UPD_PROBS[position])) {
          this.scanOrder[position] = bc.readBits(4);
        }
      }
      this.updateScan();
    } else {
      this.resetScan(interlaced);
    }

    this.zeroRunProbs.forEach((probs, index) => {
      T.HAS_ZERO_RUN_PROBS[index].forEach((has, slot) => {
        if (bc.readProb(has)) {
          probs[slot] = bc.readProbability();
        }
      });
    });

    T.VP6_AC_PROBS.forEach((planes, ctype) => {
      this.coeff.forEach((model, plane) => {
        const groups = planes[plane];
        const target = model.acValProbs[ctype];

        groups.forEach((has, group) => {
          has.forEach((hasProb, slot) => {
            if (bc.readProb(hasProb)) {
              defProb[slot] = bc.readProbability();
              target[group][slot] = defProb[slot];
            } else if (isIntra) {
              target[group][slot] = defProb[slot];
            }
          });
        });
      });
    });

    for (const model of this.coeff) {
      model.dcTokenProbs.forEach((probs, ctx) => {
        for (let k = 0; k < probs.length; k++) {
          probs[k] = rescaleProb(
            model.dcValueProbs[k] ?? 128,
            T.VP6_DC_WEIGHTS[k]?.[ctx] ?? [0, 1],
          );
        }
      });
    }
  }

  /** Builds the Huffman tables a frame that codes its coefficients with Huffman reads from */
  public buildHuffman(): void {
    this.huff.dc = this.coeff.map((model) =>
      HuffmanCode.fromTokenProbs(model.dcValueProbs),
    );
    this.huff.ac = this.coeff.map((model) =>
      model.acValProbs.map((mode) =>
        mode.map((probs) => HuffmanCode.fromTokenProbs(probs)),
      ),
    );
    this.huff.zeroRun = this.zeroRunProbs.map((probs) =>
      HuffmanCode.fromZeroRunProbs(probs),
    );
  }
}
