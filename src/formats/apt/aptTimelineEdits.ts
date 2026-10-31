import { EASINGS, compileExpression } from '../../core/expression';
import type { Matrix2 } from './aptMovie';
import { getPose, withPose } from './aptPose';
import type { Pose, PoseFormulas } from './aptPose';
import { isSameSlot } from './aptTimeline';
import type { FrameState, Slot } from './aptTimeline';

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
  const base = getPose(start);
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
    // What the formulas leave alone keeps its own frame's value
    const here = states[frame].display.get(depth);
    const pose =
      here && here.token === start.token ? getPose(here) : { ...base };

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
    isSameSlot(states[frame].display.get(depth), end);
    frame++
  ) {
    next[frame].display.set(depth, { ...next[to].display.get(depth)! });
  }
  return next;
};

/** Tweens a depth in a straight line from its pose at `from` to `end` at `to`, eased */
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
        withPose(slot, { ...getPose(slot), alpha: 0 }),
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
      withPose({ ...model }, { ...getPose(model), alpha: 1 }),
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
        const pa = getPose(a);
        const pb = getPose(b);
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

/** Per-frame change of a pose from its first frame: added, scales multiplied */
export type Motion = Pose[];

/** Reads the motion of a depth over frames `from`..`to`, relative to its first frame */
export const readMotion = (
  states: FrameState[],
  depth: number,
  from: number,
  to: number,
): Motion => {
  checkRange(states, from, to);

  const start = states[from].display.get(depth);

  if (!start) {
    throw new Error(`Nothing is placed at depth ${depth} in frame ${from}`);
  }

  const base = getPose(start);

  return states.slice(from, to + 1).map((state) => {
    const slot = state.display.get(depth);
    const pose = slot && slot.token === start.token ? getPose(slot) : base;

    return {
      x: pose.x - base.x,
      y: pose.y - base.y,
      scaleX: base.scaleX ? pose.scaleX / base.scaleX : 1,
      scaleY: base.scaleY ? pose.scaleY / base.scaleY : 1,
      rotation: pose.rotation - base.rotation,
      skew: pose.skew - base.skew,
      alpha: pose.alpha - base.alpha,
    };
  });
};

/**
 * Plays a motion on a depth from frame `at`, relative to its pose there;
 * mirrored across the vertical axis (`x`) or the horizontal one (`y`).
 * Frames past the timeline's end are left out.
 */
export const applyMotion = (
  states: FrameState[],
  depth: number,
  at: number,
  motion: Motion,
  mirror?: 'x' | 'y',
): FrameState[] => {
  const start = states[at]?.display.get(depth);

  if (!start) {
    throw new Error(`Nothing is placed at depth ${depth} in frame ${at}`);
  }

  const base = getPose(start);
  const next = cloneStates(states);
  const flipX = mirror === 'x' ? -1 : 1;
  const flipY = mirror === 'y' ? -1 : 1;
  const turn = mirror ? -1 : 1;

  motion.forEach((change, offset) => {
    const frame = at + offset;

    if (frame >= next.length) {
      return;
    }
    next[frame].display.set(
      depth,
      withPose(
        { ...start },
        {
          x: base.x + change.x * flipX,
          y: base.y + change.y * flipY,
          scaleX: base.scaleX * change.scaleX,
          scaleY: base.scaleY * change.scaleY,
          rotation: base.rotation + change.rotation * turn,
          skew: base.skew + change.skew * turn,
          alpha: base.alpha + change.alpha,
        },
      ),
    );
  });
  // Frames after it that only held the old last pose hold the new one
  const last = Math.min(next.length - 1, at + motion.length - 1);
  const held = states[last].display.get(depth);

  for (
    let frame = last + 1;
    frame < states.length &&
    held &&
    isSameSlot(states[frame].display.get(depth), held);
    frame++
  ) {
    next[frame].display.set(depth, { ...next[last].display.get(depth)! });
  }
  return next;
};

/** A timeline operation of this module as a value the editor page can send */
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
  | { op: 'retime'; from: number; to: number; length: number }
  | {
      op: 'motion';
      depth: number;
      at: number;
      motion: Motion;
      mirror?: 'x' | 'y';
    };

/** Applies one timeline operation to the frame states, returning new ones */
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
    case 'motion':
      return applyMotion(
        states,
        operation.depth,
        operation.at,
        operation.motion,
        operation.mirror,
      );
    case 'retime':
      return retimeFrames(
        states,
        operation.from,
        operation.to,
        operation.length,
      );
  }
};
