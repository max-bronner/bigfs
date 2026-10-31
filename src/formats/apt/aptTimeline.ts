import { AptReader } from './aptMovie';
import type { Frame, Matrix2 } from './aptMovie';

/**
 * Edits a timeline as what is on stage at every frame, so it can be edited the
 * way an animation editor edits it, and written back as the records APT
 * keeps. APT has no tweens: like a published Flash file, every frame of a
 * motion is baked into its own PlaceObject. Editing frames one by one is
 * what these operations spare: a tween, a formula, hiding or showing for
 * a range, inserting, deleting, duplicating, reversing and retiming
 * frames all edit the per-frame states, and `encodeTimeline` turns them
 * back into the fewest records: a new placement, a move, or a removal.
 *
 * A frame whose state and whose previous frame's state come through an
 * operation unchanged keeps its original records, byte for byte.
 */

/** A placement at a depth in one frame */
export interface Slot {
  /** One instance across frames: a move keeps it, a new placement makes another */
  token: string;
  character: number;
  matrix: Matrix2;
  translate: [number, number];
  /** Multiply term, memory order R, G, B, A */
  colorTransform?: number;
  colorAdd?: number;
  ratio?: number;
  name?: string;
  clipDepth?: number;
  /** The clip action list of the record that placed it, kept as a pointer */
  clipActions?: number;
}

/** One frame of a decoded timeline: what is on stage, plus the records kept as they are */
export interface FrameState {
  display: Map<number, Slot>;
  /** Records kept as they are, in order: actions, init actions and the like */
  kept: number[];
  /** Frame labels with their record's flags; written with the frame they end up on */
  labels: Label[];
  /** The original frame this one is, while its records may still be reused */
  source?: number;
}

/** A frame label and its record's flags */
export interface Label {
  label: string;
  flags: number;
}

/** How a frame is written: its original records, or new ones */
export type FrameSpec =
  | { reuse: number }
  | {
      items: (
        { reuse: number } | { remove: number } | Label | { place: PlaceSpec }
      )[];
    };

/** A PlaceObject record to write, as `encodeTimeline` describes it */
export interface PlaceSpec {
  /** A change to what is already at the depth, not a new instance */
  move: boolean;
  depth: number;
  character?: number;
  matrix?: Matrix2;
  translate?: [number, number];
  colorTransform?: number;
  colorAdd?: number;
  ratio?: number;
  name?: string;
  clipDepth?: number;
  clipActions?: number;
}

/**
 * Reads a timeline's frames into what is on stage at each. Without the
 * movie's bytes, clip action lists are not kept, which is enough to look
 * at a timeline but not to write it back.
 */
export const decodeTimeline = (
  apt: Uint8Array | undefined,
  frames: Frame[],
): FrameState[] => {
  const reader = apt && new AptReader(apt);
  const display = new Map<number, Slot>();

  return frames.map((frame, index) => {
    const kept: number[] = [];
    const labels: Label[] = [];

    for (const item of frame.items) {
      if (item.type === 'removeObject') {
        display.delete(item.depth);
      } else if (item.type === 'placeObject') {
        const existing = display.get(item.depth);
        const isNew =
          !(item.flags & 1) ||
          !existing ||
          (item.character !== undefined &&
            item.character !== existing.character);
        const slot: Slot = isNew
          ? {
              token: `${index}@${item.depth}`,
              character: item.character ?? existing?.character ?? 0,
              matrix: [1, 0, 0, 1],
              translate: [0, 0],
              clipActions:
                item.flags & 0x80
                  ? reader?.u32(item.offset + 60) || undefined
                  : undefined,
            }
          : { ...existing };

        if (item.matrix) {
          slot.matrix = item.matrix;
          slot.translate = item.translate ?? [0, 0];
        }
        if (item.colorTransform !== undefined) {
          slot.colorTransform = item.colorTransform;
          slot.colorAdd = item.colorAdd;
        }
        if (item.ratio !== undefined) {
          slot.ratio = item.ratio;
        }
        if (item.name !== undefined) {
          slot.name = item.name;
        }
        if (item.clipDepth !== undefined) {
          slot.clipDepth = item.clipDepth;
        }
        display.set(item.depth, slot);
      } else if (item.type === 'frameLabel') {
        labels.push({ label: item.label, flags: item.flags });
      } else {
        kept.push(item.offset);
      }
    }

    return {
      display: new Map(
        [...display].map(([depth, slot]) => [depth, { ...slot }]),
      ),
      kept,
      labels,
      source: index,
    };
  });
};

const SLOT_KEYS: (keyof Slot)[] = [
  'token',
  'character',
  'matrix',
  'translate',
  'colorTransform',
  'colorAdd',
  'ratio',
  'name',
  'clipDepth',
  'clipActions',
];

/** Whether two placements match in every field `SLOT_KEYS` lists */
export const isSameSlot = (a: Slot | undefined, b: Slot | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    SLOT_KEYS.every(
      (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]),
    ));

const isSameDisplay = (
  a: Map<number, Slot> | undefined,
  b: Map<number, Slot> | undefined,
) =>
  (a?.size ?? 0) === (b?.size ?? 0) &&
  [...(a ?? new Map<number, Slot>())].every(([depth, slot]) =>
    isSameSlot(slot, b?.get(depth)),
  );

/** Writes states back as records, reusing each frame that came through unchanged */
export const encodeTimeline = (
  original: FrameState[],
  next: FrameState[],
): FrameSpec[] =>
  next.map((state, index) => {
    const source = state.source;
    const before = original[source ?? -1];

    if (
      source !== undefined &&
      before &&
      (index === source || !state.labels.length) &&
      isSameDisplay(state.display, before.display) &&
      isSameDisplay(next[index - 1]?.display, original[source - 1]?.display) &&
      JSON.stringify([state.kept, state.labels]) ===
        JSON.stringify([before.kept, before.labels])
    ) {
      return { reuse: source };
    }

    const previous = next[index - 1]?.display ?? new Map<number, Slot>();
    const items: Extract<FrameSpec, { items: unknown }>['items'] = [];

    for (const depth of previous.keys()) {
      const now = state.display.get(depth);

      if (!now || now.token !== previous.get(depth)!.token) {
        items.push({ remove: depth });
      }
    }
    for (const [depth, slot] of [...state.display].sort(
      (a, b) => a[0] - b[0],
    )) {
      const was = previous.get(depth);

      if (!was || was.token !== slot.token) {
        items.push({
          place: {
            move: false,
            depth,
            character: slot.character,
            matrix: slot.matrix,
            translate: slot.translate,
            colorTransform: slot.colorTransform,
            colorAdd: slot.colorAdd,
            ratio: slot.ratio,
            name: slot.name,
            clipDepth: slot.clipDepth,
            clipActions: slot.clipActions,
          },
        });
      } else if (!isSameSlot(was, slot)) {
        const moved =
          was.matrix.some((value, at) => value !== slot.matrix[at]) ||
          was.translate.some((value, at) => value !== slot.translate[at]);
        const coloured =
          was.colorTransform !== slot.colorTransform ||
          was.colorAdd !== slot.colorAdd;

        items.push({
          place: {
            move: true,
            depth,
            ...(moved
              ? { matrix: slot.matrix, translate: slot.translate }
              : {}),
            ...(coloured
              ? {
                  colorTransform: slot.colorTransform ?? 0xffffffff,
                  colorAdd: slot.colorAdd ?? 0,
                }
              : {}),
            ...(was.ratio !== slot.ratio ? { ratio: slot.ratio ?? 0 } : {}),
            ...(was.name !== slot.name && slot.name ? { name: slot.name } : {}),
          },
        });
      }
    }
    items.push(...state.labels, ...state.kept.map((reuse) => ({ reuse })));
    return { items };
  });
