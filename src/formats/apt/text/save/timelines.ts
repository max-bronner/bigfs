import type { FrameSpec } from '../../aptTimeline';
import type { PlacementChange, PlacementField } from '../../writer/aptEdit';
import type {
  ClipActionText,
  FrameText,
  ItemText,
  MovieText,
} from '../textModel';
import { alignLists, checkAppended, printItem } from './alignLists';
import { sameFloat, sameFloats } from './sameFloats';
import type { SaveSession } from './saveSession';
import { TextSaveError } from './textSaveError';

/** Writes the frames of every timeline the text changed, item by item */
export const saveTimelines = (session: SaveSession, after: MovieText): void => {
  for (const next of after.characters) {
    if (next.type === 'sprite' || next.type === 'movie') {
      saveTimeline(session, next.id, next.frames, next.line ?? 0);
    }
  }
};

/** The current frames of a timeline */
const timelineFrames = (
  session: SaveSession,
  timeline: number,
): FrameText[] => {
  const character = session.current().characters[timeline];

  return character.type === 'sprite' || character.type === 'movie'
    ? character.frames
    : [];
};

const saveTimeline = (
  session: SaveSession,
  timeline: number,
  after: FrameText[],
  line: number,
): void => {
  let before = timelineFrames(session, timeline);

  if (!after.length) {
    throw new TextSaveError('A timeline keeps at least one frame', line);
  }
  for (let count = before.length; count < after.length; count++) {
    session.apply({ kind: 'addFrame', timeline });
  }
  before = timelineFrames(session, timeline);

  const orders: (number[] | undefined)[] = [];
  let isReordered = after.length < before.length;

  after.forEach((frame, index) => {
    const order = saveFrame(
      session,
      timeline,
      index,
      before[index].items,
      frame,
    );

    orders.push(order);
    isReordered ||= order !== undefined;
  });

  if (isReordered) {
    session.orders.set(timeline, orders);
  }
};

/**
 * Edits the items of one frame in place and adds the new ones at its end.
 * Returns the order the frame's records must be written in, when edits
 * in place and removals cannot give it.
 */
const saveFrame = (
  session: SaveSession,
  timeline: number,
  frame: number,
  before: ItemText[],
  after: FrameText,
): number[] | undefined => {
  const pairs = alignLists(before, after.items, printItem, (item) => item.type);
  const order: number[] = [];

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after.items[j];

    order.push(
      i === undefined
        ? addItem(session, timeline, frame, next)
        : saveItem(session, before[i], next),
    );
  }

  const kept = before.map((item) => item.offset!);
  const removed = pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => before[i!].offset!);
  const remaining = [...kept];

  for (const offset of removed) {
    remaining.splice(remaining.indexOf(offset), 1);
  }

  const added = order.filter((offset) => !kept.includes(offset));

  if (JSON.stringify([...remaining, ...added]) === JSON.stringify(order)) {
    for (const offset of removed) {
      session.apply({ kind: 'removeItem', timeline, frame, offset });
    }
    return undefined;
  }
  return order;
};

/** Adds an item the text has and the movie does not; returns its record's offset */
const addItem = (
  session: SaveSession,
  timeline: number,
  frame: number,
  next: ItemText,
): number => {
  const line = next.line ?? 0;
  const offsetOfLast = () => {
    const items = timelineFrames(session, timeline)[frame].items;

    return items[items.length - 1].offset!;
  };

  switch (next.type) {
    case 'action': {
      const block = session.compile(next.script, line);

      session.apply({ kind: 'addFrameScript', timeline, frame, block });
      return offsetOfLast();
    }
    case 'label': {
      session.apply({
        kind: 'addFrameLabel',
        timeline,
        frame,
        label: next.label,
      });

      const offset = offsetOfLast();

      if (next.flags || next.frame !== frame) {
        session.apply({
          kind: 'frameLabel',
          offset,
          ...(next.flags ? { flags: next.flags } : {}),
          ...(next.frame !== frame ? { frame: next.frame } : {}),
        });
      }
      return offset;
    }
    case 'place': {
      session.apply({
        kind: 'placeObject',
        timeline,
        frame,
        depth: next.depth,
        character: next.character ?? 0,
        ...(next.placement
          ? {
              matrix: next.placement.matrix,
              translate: next.placement.translate,
            }
          : {}),
        ...(next.name ? { name: next.name } : {}),
      });

      return saveItem(
        session,
        timelineFrames(session, timeline)[frame].items.at(-1)!,
        next,
      );
    }
    case 'remove':
      session.apply({
        kind: 'removeObject',
        timeline,
        frame,
        depth: next.depth,
      });
      return offsetOfLast();
    case 'background':
      session.apply({
        kind: 'addBackgroundColor',
        timeline,
        frame,
        color: next.color,
      });
      return offsetOfLast();
    case 'initAction':
      throw new TextSaveError(
        'An init action cannot be added from text; add a frame action instead',
        line,
      );
    case 'unknown':
      throw new TextSaveError('An unknown item cannot be added', line);
  }
};

/** Edits an item in place to match the text; returns its record's offset */
const saveItem = (
  session: SaveSession,
  was: ItemText,
  next: ItemText,
): number => {
  const offset = was.offset!;
  const line = next.line ?? 0;

  switch (next.type) {
    case 'action':
      if (was.type === 'action') {
        session.script(was.script, next.script);
      }
      break;
    case 'label':
      if (was.type === 'label') {
        const change = {
          ...(was.label !== next.label ? { label: next.label } : {}),
          ...(was.flags !== next.flags ? { flags: next.flags } : {}),
          ...(was.frame !== next.frame ? { frame: next.frame } : {}),
        };

        if (Object.keys(change).length) {
          session.apply({ kind: 'frameLabel', offset, ...change });
        }
      }
      break;
    case 'remove':
      if (was.type === 'remove' && was.depth !== next.depth) {
        session.apply({ kind: 'removeObjectDepth', offset, depth: next.depth });
      }
      break;
    case 'background':
      if (was.type === 'background' && was.color !== next.color) {
        session.apply({ kind: 'backgroundColor', offset, color: next.color });
      }
      break;
    case 'initAction':
      if (was.type === 'initAction') {
        if (was.sprite !== next.sprite) {
          session.apply({ kind: 'initAction', offset, sprite: next.sprite });
        }
        session.script(was.script, next.script);
      }
      break;
    case 'unknown':
      if (was.type === 'unknown' && was.itemType !== next.itemType) {
        throw new TextSaveError('An unknown item keeps its type', line);
      }
      break;
    case 'place':
      if (was.type === 'place') {
        savePlacement(session, was, next);
      }
      break;
  }
  return offset;
};

const savePlacement = (
  session: SaveSession,
  was: Extract<ItemText, { type: 'place' }>,
  next: Extract<ItemText, { type: 'place' }>,
): void => {
  const offset = was.offset!;
  const line = next.line ?? 0;
  const clear: PlacementField[] = [];
  const change: PlacementChange = {};

  if (((was.flags ^ next.flags) & ~0xff) !== 0) {
    throw new TextSaveError(
      'flags= above 0xff are not gated by a field and cannot change',
      line,
    );
  }
  if (was.depth !== next.depth) {
    change.depth = next.depth;
  }
  if (was.character !== next.character) {
    if (next.character === undefined) {
      clear.push('character');
    } else {
      change.character = next.character;
    }
  }
  if (
    Boolean(was.placement) !== Boolean(next.placement) ||
    (was.placement &&
      next.placement &&
      (!sameFloats(was.placement.matrix, next.placement.matrix) ||
        !sameFloats(was.placement.translate, next.placement.translate)))
  ) {
    if (next.placement) {
      change.matrix = next.placement.matrix;
      change.translate = next.placement.translate;
    } else {
      clear.push('matrix');
    }
  }
  if (
    was.colorTransform !== next.colorTransform ||
    was.colorAdd !== next.colorAdd
  ) {
    if (next.colorTransform === undefined) {
      clear.push('colorTransform');
    } else {
      change.colorTransform = next.colorTransform;
      change.colorAdd = next.colorAdd ?? 0;
    }
  }
  if (!sameFloat(was.ratio, next.ratio)) {
    if (next.ratio === undefined) {
      clear.push('ratio');
    } else {
      change.ratio = next.ratio;
    }
  }
  if (was.name !== next.name) {
    if (next.name === undefined) {
      clear.push('name');
    } else {
      change.name = next.name;
    }
  }
  if (was.clipDepth !== next.clipDepth) {
    if (next.clipDepth === undefined) {
      clear.push('clipDepth');
    } else {
      change.clipDepth = next.clipDepth;
    }
  }
  if ((was.flags & 1) !== (next.flags & 1)) {
    change.isMove = (next.flags & 1) !== 0;
  }
  if (clear.length) {
    change.clear = clear;
  }
  if (Object.keys(change).length) {
    session.apply({ kind: 'placement', offset, change });
  }
  saveClipActions(
    session,
    offset,
    was.clipActions ?? [],
    next.clipActions ?? [],
  );
};

const saveClipActions = (
  session: SaveSession,
  offset: number,
  before: ClipActionText[],
  after: ClipActionText[],
): void => {
  const pairs = alignLists(before, after, (action) =>
    JSON.stringify([action.events, action.script.text]),
  );

  checkAppended(pairs, after, 'clip action');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) =>
      session.apply({ kind: 'removeClipAction', offset, index }),
    );

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after[j];

    if (i === undefined) {
      session.apply({
        kind: 'addClipAction',
        offset,
        events: next.events,
        block: session.compile(next.script, next.line ?? 0),
      });
    } else {
      const was = before[i];

      if (was.events !== next.events) {
        session.apply({
          kind: 'clipAction',
          offset,
          index,
          events: next.events,
        });
      }
      session.script(was.script, next.script);
    }
    index++;
  }
};

/** Writes the frames whose records were reordered, reusing every other frame */
export const writeOrders = (session: SaveSession): void => {
  for (const [timeline, orders] of session.orders) {
    const frames: FrameSpec[] = orders.map((order, index) =>
      order ? { items: order.map((reuse) => ({ reuse })) } : { reuse: index },
    );

    session.apply({ kind: 'setTimeline', timeline, frames });
  }
};
