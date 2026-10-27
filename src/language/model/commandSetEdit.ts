import { stripComment, tokenize } from './sageIniParser';

/**
 * Rewriting a CommandSet's numbered slots as a whole: the editor moves,
 * swaps, adds and clears buttons, so the slot lines are written again
 * together, in slot order, where the first of them was. Other lines of
 * the set are left as they are.
 */

/** Replaces `remove` lines from `line` with `insert` */
export interface LineEdit {
  line: number;
  remove: number;
  insert: string[];
}

/**
 * The name a `CommandSet NAME` header line opens. A `CommandSet = NAME`
 * field, as an Object lists its set, opens nothing.
 */
export const commandSetHeader = (line: string): string | undefined =>
  /^\s*CommandSet\s+([^\s=;/]+)\s*(?:[;]|\/\/|$)/i.exec(line)?.[1];

const slotOf = (line: string) => {
  const [key] = tokenize(stripComment(line));

  return key && /^\d+$/.test(key.text) ? Number(key.text) : undefined;
};

/**
 * The edits that make the set at `startLine`..`endLine` hold `slots`
 * (slot number to button name) and nothing else in its numbered lines
 */
export const slotEdits = (
  lines: string[],
  startLine: number,
  endLine: number,
  slots: ReadonlyMap<number, string>,
): LineEdit[] => {
  const existing: number[] = [];

  for (let line = startLine + 1; line < endLine; line++) {
    if (slotOf(lines[line]) !== undefined) {
      existing.push(line);
    }
  }

  const indent =
    /^\s*/.exec(lines[existing[0] ?? startLine + 1] ?? '')![0] || '  ';
  const written = [...slots]
    .filter(([, button]) => button)
    .sort(([a], [b]) => a - b)
    .map(([slot, button]) => `${indent}${slot} = ${button}`);
  const [first, ...rest] = existing;

  if (first === undefined) {
    return written.length
      ? [{ line: endLine, remove: 0, insert: written }]
      : [];
  }
  return [
    { line: first, remove: 1, insert: written },
    ...rest.map((line) => ({ line, remove: 1, insert: [] })),
  ];
};

/** Whether two slot maps hold the same buttons */
export const sameSlots = (
  a: ReadonlyMap<number, string>,
  b: ReadonlyMap<number, string>,
): boolean =>
  a.size === b.size && [...a].every(([slot, button]) => b.get(slot) === button);

/** A slot as the editor page shows it */
export interface EditorSlot {
  slot: number;
  button: string;
  defined: boolean;
  text?: string;
  hotkey?: string;
  /** Other slots sharing this one's hotkey */
  clashes?: number[];
  command?: string;
  /** A data URI of the button's image */
  icon?: string;
}

export interface CommandSetMessage {
  kind: 'set';
  name: string;
  slots: EditorSlot[];
}

export type FromCommandSetPage =
  | { kind: 'ready' }
  | { kind: 'move'; from: number; to: number }
  | { kind: 'clear'; slot: number }
  | { kind: 'add'; slot: number; button?: string }
  | { kind: 'reveal'; slot: number };

/** The slots after moving `from` to `to`, swapping with what is there */
export const moveSlot = (
  slots: ReadonlyMap<number, string>,
  from: number,
  to: number,
): Map<number, string> => {
  const next = new Map(slots);
  const moving = slots.get(from);
  const there = slots.get(to);

  if (moving === undefined || from === to) {
    return next;
  }
  next.set(to, moving);
  if (there === undefined) {
    next.delete(from);
  } else {
    next.set(from, there);
  }
  return next;
};
