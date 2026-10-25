import { EASINGS, compileExpression } from './aptExpression';
import { AptReader } from './aptMovie';
import type { Frame, Matrix2 } from './aptMovie';

/**
 * A timeline as what is on stage at every frame, so it can be edited the
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

/** What is placed at a depth in one frame */
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

export interface FrameState {
  display: Map<number, Slot>;
  /** Records kept as they are, in order: actions, init actions and the like */
  kept: number[];
  /** Frame labels with their record's flags; written with the frame they end up on */
  labels: Label[];
  /** The original frame this one is, while its records may still be reused */
  source?: number;
}

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

/** Reads a timeline's frames into what is on stage at each */
export const decodeTimeline = (
  apt: Uint8Array,
  frames: Frame[],
): FrameState[] => {
  const reader = new AptReader(apt);
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
                  ? reader.u32(item.offset + 60) || undefined
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

const sameSlot = (a: Slot | undefined, b: Slot | undefined): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    SLOT_KEYS.every(
      (key) => JSON.stringify(a[key]) === JSON.stringify(b[key]),
    ));

const sameDisplay = (
  a: Map<number, Slot> | undefined,
  b: Map<number, Slot> | undefined,
) =>
  (a?.size ?? 0) === (b?.size ?? 0) &&
  [...(a ?? new Map<number, Slot>())].every(([depth, slot]) =>
    sameSlot(slot, b?.get(depth)),
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
      sameDisplay(state.display, before.display) &&
      sameDisplay(next[index - 1]?.display, original[source - 1]?.display) &&
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
      } else if (!sameSlot(was, slot)) {
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

const cloneStates = (states: FrameState[]): FrameState[] =>
  states.map((state) => ({
    ...state,
    display: new Map(
      [...state.display].map(([depth, slot]) => [
        depth,
        {
          ...slot,
          matrix: [...slot.matrix] as Matrix2,
          translate: [...slot.translate] as [number, number],
        },
      ]),
    ),
    kept: [...state.kept],
    labels: state.labels.map((label) => ({ ...label })),
  }));

const checkRange = (states: FrameState[], from: number, to: number) => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to >= states.length ||
    from > to
  ) {
    throw new Error(
      `Frames ${from} to ${to} are not in the timeline's ${states.length}`,
    );
  }
};

/** The parts of a placement an animation sets: in pixels, degrees and 0..1 */
export interface Pose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skew: number;
  alpha: number;
}

export const poseOf = (slot: Slot): Pose => {
  const [a, b, c, d] = slot.matrix;
  const scaleX = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const scaleY = scaleX ? (a * d - b * c) / scaleX : Math.hypot(c, d);

  return {
    x: slot.translate[0],
    y: slot.translate[1],
    scaleX,
    scaleY,
    rotation: (rotation * 180) / Math.PI,
    skew: scaleX ? (a * c + b * d) / (scaleX * scaleX) : 0,
    alpha:
      slot.colorTransform === undefined
        ? 1
        : (slot.colorTransform >>> 24) / 255,
  };
};

/** A slot with a pose applied; colour other than alpha is kept */
export const withPose = (slot: Slot, pose: Pose): Slot => {
  const radians = (pose.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const alpha = Math.round(Math.min(1, Math.max(0, pose.alpha)) * 255);
  const round = (value: number) => Math.round(value * 1e4) / 1e4;

  return {
    ...slot,
    matrix: [
      round(pose.scaleX * cos),
      round(pose.scaleX * sin),
      round(pose.scaleX * pose.skew * cos - pose.scaleY * sin),
      round(pose.scaleX * pose.skew * sin + pose.scaleY * cos),
    ],
    translate: [round(pose.x), round(pose.y)],
    colorTransform:
      alpha === 255 &&
      (slot.colorTransform === undefined ||
        (slot.colorTransform & 0xffffff) === 0xffffff)
        ? slot.colorTransform === undefined
          ? undefined
          : ((slot.colorTransform & 0xffffff) | (255 << 24)) >>> 0
        : (((slot.colorTransform ?? 0xffffffff) & 0xffffff) | (alpha << 24)) >>>
          0,
  };
};

export type PoseFormulas = Partial<Record<keyof Pose, string>>;

/**
 * Sets a depth's pose over frames `from`..`to` by formulas of `t` (0 at
 * `from`, 1 at `to`, eased), `f` (the frame), `i` (frames since `from`)
 * and `n` (frames in the range), with the pose at `from` as `x0`, `y0`,
 * `scaleX0`, `rotation0`, `alpha0` and so on. The instance at `from` is
 * kept through the range, placed where it was missing.
 */
export const animate = (
  states: FrameState[],
  depth: number,
  from: number,
  to: number,
  formulas: PoseFormulas,
  easing = 'linear',
): FrameState[] => {
  checkRange(states, from, to);

  const start = states[from].display.get(depth);
  const ease = EASINGS[easing];

  if (!start) {
    throw new Error(`Nothing is placed at depth ${depth} in frame ${from}`);
  }
  if (!ease) {
    throw new Error(`There is no easing called ${easing}`);
  }

  const compiled = Object.entries(formulas)
    .filter(([, formula]) => formula !== undefined && formula.trim() !== '')
    .map(([key, formula]) => [key, compileExpression(formula!)] as const);
  const base = poseOf(start);
  const startVariables = Object.fromEntries(
    Object.entries(base).map(([key, value]) => [`${key}0`, value]),
  );
  const next = cloneStates(states);
  const count = to - from + 1;

  for (let frame = from; frame <= to; frame++) {
    const i = frame - from;
    const variables = {
      ...startVariables,
      t: ease(count > 1 ? i / (count - 1) : 1),
      f: frame,
      i,
      n: count,
    };
    const pose = { ...base };

    for (const [key, formula] of compiled) {
      pose[key as keyof Pose] = formula(variables);
    }
    next[frame].display.set(
      depth,
      withPose({ ...start, token: start.token }, pose),
    );
  }
  // Frames after the range that only held the old end pose now hold the new one
  const end = states[to].display.get(depth);

  for (
    let frame = to + 1;
    frame < states.length &&
    end &&
    sameSlot(states[frame].display.get(depth), end);
    frame++
  ) {
    next[frame].display.set(depth, { ...next[to].display.get(depth)! });
  }
  return next;
};

/** A straight tween from the pose at `from` to `end` at `to`, eased */
export const tween = (
  states: FrameState[],
  depth: number,
  from: number,
  to: number,
  end: Partial<Pose>,
  easing = 'linear',
): FrameState[] =>
  animate(
    states,
    depth,
    from,
    to,
    Object.fromEntries(
      Object.entries(end).map(([key, value]) => [
        key,
        `${key}0 + (${value} - ${key}0) * t`,
      ]),
    ),
    easing,
  );

/**
 * Hides a depth for frames `from`..`to`: at alpha 0, which keeps the
 * instance (its nested animation goes on), or removed, which places it
 * again afterwards
 */
export const hide = (
  states: FrameState[],
  depth: number,
  from: number,
  to: number,
  how: 'alpha' | 'remove',
): FrameState[] => {
  checkRange(states, from, to);

  const next = cloneStates(states);

  for (let frame = from; frame <= to; frame++) {
    const slot = next[frame].display.get(depth);

    if (!slot) {
      continue;
    }
    if (how === 'remove') {
      next[frame].display.delete(depth);
    } else {
      next[frame].display.set(
        depth,
        withPose(slot, { ...poseOf(slot), alpha: 0 }),
      );
    }
  }
  // An instance shown again after a removal is a new one
  if (how === 'remove' && next[to + 1]?.display.has(depth)) {
    const after = next[to + 1].display.get(depth)!.token;

    for (
      let frame = to + 1;
      next[frame]?.display.get(depth)?.token === after;
      frame++
    ) {
      next[frame].display.get(depth)!.token = `${after}+${to + 1}`;
    }
  }
  return next;
};

/** Shows a depth for frames `from`..`to` as it is at `like`, fully opaque */
export const show = (
  states: FrameState[],
  depth: number,
  from: number,
  to: number,
  like: number,
): FrameState[] => {
  checkRange(states, from, to);

  const model = states[like]?.display.get(depth);

  if (!model) {
    throw new Error(
      `Nothing is placed at depth ${depth} in frame ${like} to show`,
    );
  }

  const next = cloneStates(states);

  for (let frame = from; frame <= to; frame++) {
    next[frame].display.set(
      depth,
      withPose({ ...model }, { ...poseOf(model), alpha: 1 }),
    );
  }
  return next;
};

/** Inserts `count` frames before `at`, each showing what the frame before shows */
export const insertFrames = (
  states: FrameState[],
  at: number,
  count: number,
): FrameState[] => {
  if (
    !Number.isInteger(at) ||
    at < 0 ||
    at > states.length ||
    !Number.isInteger(count) ||
    count < 1
  ) {
    throw new Error(`Cannot insert ${count} frames at ${at}`);
  }

  const next = cloneStates(states);
  const model = next[at - 1]?.display ?? new Map<number, Slot>();
  const added = Array.from({ length: count }, (): FrameState => ({
    display: new Map([...model].map(([depth, slot]) => [depth, { ...slot }])),
    kept: [],
    labels: [],
  }));

  next.splice(at, 0, ...added);
  return next;
};

/** Deletes frames `from`..`to`, their scripts and labels with them */
export const deleteFrames = (
  states: FrameState[],
  from: number,
  to: number,
): FrameState[] => {
  checkRange(states, from, to);
  if (to - from + 1 >= states.length) {
    throw new Error('A timeline keeps at least one frame');
  }

  const next = cloneStates(states);

  next.splice(from, to - from + 1);
  return next;
};

/** Copies frames `from`..`to` after `to`; the copies run the same scripts but carry no labels */
export const duplicateFrames = (
  states: FrameState[],
  from: number,
  to: number,
): FrameState[] => {
  checkRange(states, from, to);

  const next = cloneStates(states);
  const copies = cloneStates(states.slice(from, to + 1)).map((state) => ({
    ...state,
    labels: [],
    source: undefined,
  }));

  next.splice(to + 1, 0, ...copies);
  return next;
};

/** Plays frames `from`..`to` backwards; scripts and labels stay on their frames */
export const reverseFrames = (
  states: FrameState[],
  from: number,
  to: number,
): FrameState[] => {
  checkRange(states, from, to);

  const next = cloneStates(states);
  const displays = next
    .slice(from, to + 1)
    .map((state) => state.display)
    .reverse();

  displays.forEach((display, offset) => {
    next[from + offset].display = display;
    next[from + offset].source = undefined;
  });
  return next;
};

/**
 * Stretches or squeezes frames `from`..`to` to `length` frames. A placement
 * that is the same instance on both sides of a new frame is interpolated;
 * anything else takes the nearer frame. Scripts and labels go with the
 * frame they map to.
 */
export const retimeFrames = (
  states: FrameState[],
  from: number,
  to: number,
  length: number,
): FrameState[] => {
  checkRange(states, from, to);
  if (!Number.isInteger(length) || length < 1) {
    throw new Error('A range keeps at least one frame');
  }

  const span = to - from;
  const range = cloneStates(states.slice(from, to + 1));
  const resampled = Array.from({ length }, (_, index): FrameState => {
    const at = length > 1 ? (index * span) / (length - 1) : 0;
    const low = Math.floor(at);
    const high = Math.min(span, low + 1);
    const t = at - low;
    const near = range[Math.round(at)];
    const display = new Map<number, Slot>();

    for (const [depth, slot] of near.display) {
      const a = range[low].display.get(depth);
      const b = range[high].display.get(depth);

      if (a && b && a.token === b.token && t > 0) {
        const pa = poseOf(a);
        const pb = poseOf(b);
        const pose = Object.fromEntries(
          (Object.keys(pa) as (keyof Pose)[]).map((key) => [
            key,
            pa[key] + (pb[key] - pa[key]) * t,
          ]),
        ) as unknown as Pose;

        display.set(depth, withPose(a, pose));
      } else {
        display.set(depth, { ...slot });
      }
    }
    return { display, kept: [], labels: [] };
  });

  // Each original frame's scripts and labels go to the first new frame showing it
  range.forEach((state, offset) => {
    const target =
      length > 1 ? Math.round((offset * (length - 1)) / (span || 1)) : 0;

    resampled[Math.min(length - 1, target)].kept.push(...state.kept);
    resampled[Math.min(length - 1, target)].labels.push(...state.labels);
  });

  const next = cloneStates(states);

  next.splice(from, span + 1, ...resampled);
  return next;
};

/** One of the operations above, as a value the editor page can send */
export type TimelineOperation =
  | {
      op: 'animate';
      depth: number;
      from: number;
      to: number;
      formulas: PoseFormulas;
      easing?: string;
    }
  | {
      op: 'tween';
      depth: number;
      from: number;
      to: number;
      end: Partial<Pose>;
      easing?: string;
    }
  | {
      op: 'hide';
      depth: number;
      from: number;
      to: number;
      how: 'alpha' | 'remove';
    }
  | { op: 'show'; depth: number; from: number; to: number; like: number }
  | { op: 'insert'; at: number; count: number }
  | { op: 'delete'; from: number; to: number }
  | { op: 'duplicate'; from: number; to: number }
  | { op: 'reverse'; from: number; to: number }
  | { op: 'retime'; from: number; to: number; length: number };

export const applyOperation = (
  states: FrameState[],
  operation: TimelineOperation,
): FrameState[] => {
  switch (operation.op) {
    case 'animate':
      return animate(
        states,
        operation.depth,
        operation.from,
        operation.to,
        operation.formulas,
        operation.easing,
      );
    case 'tween':
      return tween(
        states,
        operation.depth,
        operation.from,
        operation.to,
        operation.end,
        operation.easing,
      );
    case 'hide':
      return hide(
        states,
        operation.depth,
        operation.from,
        operation.to,
        operation.how,
      );
    case 'show':
      return show(
        states,
        operation.depth,
        operation.from,
        operation.to,
        operation.like,
      );
    case 'insert':
      return insertFrames(states, operation.at, operation.count);
    case 'delete':
      return deleteFrames(states, operation.from, operation.to);
    case 'duplicate':
      return duplicateFrames(states, operation.from, operation.to);
    case 'reverse':
      return reverseFrames(states, operation.from, operation.to);
    case 'retime':
      return retimeFrames(
        states,
        operation.from,
        operation.to,
        operation.length,
      );
  }
};
