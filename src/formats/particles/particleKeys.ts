import type { IniDefinition } from './particleIni';

/**
 * Writing a particle system's colour and alpha keys as a whole: the curve
 * editor adds, removes and reorders keys, which renumbers them, so the key
 * lines are rewritten together rather than token by token. Keys are
 * `Color1`..`Color8` (`R:r G:g B:b frame`) and `Alpha1`..`Alpha8`
 * (`min max frame`); a block-form system keeps them in its `Color` and
 * `Alpha` modules, a flat one at its own level.
 */

/** Kind of particle key: a colour key or an alpha key */
export type KeyKind = 'Color' | 'Alpha';

/** A colour key in 0..255 channels, or an alpha key's range */
export type KeyValue =
  | { rgb: [number, number, number]; frame: number }
  | { min: number; max: number; frame: number };

/** Replaces `remove` lines from `line` with `insert` (which may be empty) */
export interface LineEdit {
  line: number;
  remove: number;
  insert: string[];
}

/** Most keys of one kind a system holds: `Color1`..`Color8`, `Alpha1`..`Alpha8` */
export const MAX_KEYS = 8;

const keyPattern = (kind: KeyKind) =>
  new RegExp(`^${kind.toLowerCase()}[1-8]$`, 'i');

/** Formats one key as the INI writes it, without indentation */
export const keyLine = (
  kind: KeyKind,
  index: number,
  key: KeyValue,
): string => {
  const frame = Math.max(0, Math.round(key.frame));

  if ('rgb' in key) {
    const [r, g, b] = key.rgb.map((value) =>
      Math.max(0, Math.min(255, Math.round(value))),
    );

    return `${kind}${index + 1} = R:${r} G:${g} B:${b} ${frame}`;
  }
  return `${kind}${index + 1} = ${key.min.toFixed(2)} ${key.max.toFixed(2)} ${frame}`;
};

const indentOf = (line: string | undefined) => /^\s*/.exec(line ?? '')![0];

/** Computes the edits that make `definition` hold exactly `keys`, in order, of `kind` */
export const keyEdits = (
  text: string,
  definition: IniDefinition,
  kind: KeyKind,
  keys: KeyValue[],
): LineEdit[] => {
  if (keys.length > MAX_KEYS) {
    throw new Error(`A system holds at most ${MAX_KEYS} ${kind} keys`);
  }

  const lines = text.split(/\r?\n/);
  const pattern = keyPattern(kind);
  const existing = definition.lines.filter((line) =>
    pattern.test(line.keyword.text),
  );
  const written = (indent: string) =>
    keys.map((key, index) => indent + keyLine(kind, index, key));

  if (existing.length) {
    const [first, ...rest] = existing;

    return [
      {
        line: first.line,
        remove: 1,
        insert: written(indentOf(lines[first.line])),
      },
      ...rest.map((line) => ({ line: line.line, remove: 1, insert: [] })),
    ];
  }
  if (!keys.length) {
    return [];
  }
  if (definition.keyword !== 'FXParticleSystem') {
    const indent = indentOf(lines[definition.lines[0]?.line]) || '  ';

    return [{ line: definition.endLine, remove: 0, insert: written(indent) }];
  }

  const module = definition.modules.find(
    (each) => each.slot.toLowerCase() === kind.toLowerCase(),
  );

  if (module) {
    return [
      {
        line: module.line + 1,
        remove: 0,
        insert: written(indentOf(lines[module.line]) + '  '),
      },
    ];
  }

  const indent = indentOf(lines[definition.modules[0]?.line]) || '  ';

  return [
    {
      line: definition.endLine,
      remove: 0,
      insert: [
        `${indent}${kind} = Default${kind}`,
        ...written(indent + '  '),
        `${indent}End`,
      ],
    },
  ];
};

/** Applies line edits to `text`, for tests and previews */
export const applyLineEdits = (text: string, edits: LineEdit[]): string => {
  const newline = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  [...edits]
    .sort((a, b) => b.line - a.line)
    .forEach((edit) => lines.splice(edit.line, edit.remove, ...edit.insert));
  return lines.join(newline);
};
