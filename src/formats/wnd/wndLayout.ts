/**
 * SAGE window layouts (`.wnd`), read as EA's `GameWindowManagerScript.cpp`
 * reads them, by way of mint's `crates/sage/wnd`:
 *
 * - a statement is `KEY = value;`, the value running to the next `;` across
 *   lines with whitespace runs read as one space
 * - bare keywords structure the file: `STARTLAYOUTBLOCK`/`ENDLAYOUTBLOCK`
 *   hold the layout's callbacks, `WINDOW` ... `END` a window, `CHILD`
 *   before child windows and `ENDALLCHILDREN` after them
 * - a record value is `LABEL: value` items separated by spaces or commas
 *
 * Unlike mint's reader this one keeps going after a problem, so an editor
 * can show every problem at once, and it keeps offsets for each part.
 */

/** One `KEY = value;` statement, with the value's whitespace runs read as one space */
export interface WndField {
  key: string;
  value: string;
  /** From the key to past the `;` */
  start: number;
  end: number;
  keyEnd: number;
}

/** One `WINDOW` … `END` block: its fields and child windows */
export interface WndWindow {
  fields: WndField[];
  children: WndWindow[];
  /** From `WINDOW` to past its `END` */
  start: number;
  end: number;
}

/** A problem found while reading a layout, with the text span it concerns */
export interface WndProblem {
  start: number;
  end: number;
  message: string;
}

/** A parsed `.wnd` file: its layout-level fields, top windows and every problem found */
export interface WndLayout {
  fields: WndField[];
  windows: WndWindow[];
  problems: WndProblem[];
}

const KEYWORDS = new Set([
  'WINDOW',
  'END',
  'CHILD',
  'ENDALLCHILDREN',
  'STARTLAYOUTBLOCK',
  'ENDLAYOUTBLOCK',
]);

/** How deep windows may nest; the shipped files nest two deep */
const MAX_DEPTH = 16;

type Statement =
  | { kind: 'keyword'; word: string; start: number; end: number }
  | { kind: 'field'; field: WndField };

const tokenize = (text: string, problems: WndProblem[]): Statement[] => {
  const statements: Statement[] = [];
  let at = 0;

  for (;;) {
    while (at < text.length && /\s/.test(text[at])) {
      at++;
    }

    if (at >= text.length) {
      return statements;
    }

    let wordEnd = at;

    while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
      wordEnd++;
    }

    const word = text.slice(at, wordEnd);

    if (KEYWORDS.has(word)) {
      statements.push({ kind: 'keyword', word, start: at, end: wordEnd });
      at = wordEnd;
      continue;
    }

    const semicolon = text.indexOf(';', at);

    if (semicolon < 0) {
      problems.push({
        start: at,
        end: wordEnd,
        message: `${word} has no closing ;`,
      });

      return statements;
    }

    const body = text.slice(at, semicolon);
    const equals = body.indexOf('=');

    if (equals < 0) {
      problems.push({
        start: at,
        end: semicolon + 1,
        message: `${body.trim().slice(0, 40)} is neither a keyword nor KEY = value;`,
      });
    } else {
      const key = body.slice(0, equals).trim();

      statements.push({
        kind: 'field',
        field: {
          key,
          value: body
            .slice(equals + 1)
            .trim()
            .split(/\s+/)
            .join(' '),
          start: at,
          end: semicolon + 1,
          keyEnd: at + key.length,
        },
      });
    }

    at = semicolon + 1;
  }
};

/** Reads a layout, collecting every problem rather than stopping at one */
export const parseWnd = (text: string): WndLayout => {
  const problems: WndProblem[] = [];
  const statements = tokenize(text, problems);
  const layout: WndLayout = { fields: [], windows: [], problems };
  let index = 0;
  let inLayoutBlock = false;
  const misplaced = (statement: Extract<Statement, { kind: 'keyword' }>) =>
    problems.push({
      start: statement.start,
      end: statement.end,
      message: `${statement.word} is out of place here`,
    });

  const readWindow = (
    open: Extract<Statement, { kind: 'keyword' }>,
    depth: number,
  ): WndWindow => {
    const window: WndWindow = {
      fields: [],
      children: [],
      start: open.start,
      end: text.length,
    };
    let inChildren = false;

    if (depth > MAX_DEPTH) {
      problems.push({
        start: open.start,
        end: open.end,
        message: `Windows nest more than ${MAX_DEPTH} deep`,
      });
    }

    while (index < statements.length) {
      const statement = statements[index++];

      if (statement.kind === 'field') {
        window.fields.push(statement.field);
        continue;
      }

      switch (statement.word) {
        case 'END':
          window.end = statement.end;

          return window;
        case 'CHILD':
          inChildren = true;
          break;
        case 'ENDALLCHILDREN':
          if (!inChildren) {
            misplaced(statement);
          }
          inChildren = false;
          break;
        case 'WINDOW':
          if (!inChildren) {
            misplaced(statement);
          }
          if (depth <= MAX_DEPTH) {
            window.children.push(readWindow(statement, depth + 1));
          }
          break;
        default:
          misplaced(statement);
      }
    }

    problems.push({
      start: open.start,
      end: open.end,
      message: 'This WINDOW is never closed by END',
    });

    return window;
  };

  while (index < statements.length) {
    const statement = statements[index++];

    if (statement.kind === 'field') {
      layout.fields.push(statement.field);
    } else if (statement.word === 'WINDOW') {
      layout.windows.push(readWindow(statement, 1));
    } else if (statement.word === 'STARTLAYOUTBLOCK' && !inLayoutBlock) {
      inLayoutBlock = true;
    } else if (statement.word === 'ENDLAYOUTBLOCK' && inLayoutBlock) {
      inLayoutBlock = false;
    } else {
      misplaced(statement);
    }
  }

  problems.sort((a, b) => a.start - b.start);

  return layout;
};

/**
 * Finds a window's field by key, which must be given upper case; the file's
 * casing does not matter. A key stated twice reads as its
 * last statement, as mint's `wnd` reader (`field_of`) and EA's table do.
 */
export const fieldOf = (
  window: { fields: WndField[] },
  key: string,
): WndField | undefined => {
  for (let index = window.fields.length - 1; index >= 0; index--) {
    if (window.fields[index].key.toUpperCase() === key) {
      return window.fields[index];
    }
  }

  return undefined;
};

/**
 * Splits a record value into `LABEL: value` items, tokenised as EA's `strtok` over ` :,` does, so a
 * dropped comma reads the same; a quoted value stays whole
 */
export const labelled = (value: string): [string, string[]][] => {
  const items: [string, string[]][] = [];
  const pattern = /"[^"]*"?|[^\s,:]+|:/g;
  const words = value.match(pattern) ?? [];

  for (let index = 0; index < words.length; index++) {
    const word = words[index];

    if (word === ':') {
      continue;
    }

    if (words[index + 1] === ':') {
      items.push([word.toUpperCase(), []]);
    } else if (items.length) {
      items[items.length - 1][1].push(word);
    } else {
      items.push(['', [word]]);
    }
  }

  return items;
};

const numbers = (values: string[] | undefined) =>
  (values ?? []).map(Number).filter((value) => Number.isFinite(value));

/** A colour as red, green, blue and alpha, 0–255 each */
export type Rgba = [number, number, number, number];

/** One `IMAGE:` of a `*DRAWDATA` line with the `COLOR` and `BORDERCOLOR` after it */
export interface WndDrawItem {
  /** `undefined` for `NoImage` */
  image?: string;
  color: Rgba;
  border: Rgba;
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

const rgba = (values: string[] | undefined): Rgba => {
  const [r = 0, g = 0, b = 0, a = 0] = numbers(values);

  return [r, g, b, a];
};

/** Reads the slots of a `*DRAWDATA` value, one per `IMAGE:` as mint's `draw_items` reads them */
export const drawItems = (value: string): WndDrawItem[] => {
  const items: WndDrawItem[] = [];

  for (const [label, words] of labelled(value)) {
    if (label === 'IMAGE') {
      const name = unquote(words[0] ?? '');

      items.push({
        image: name && name.toUpperCase() !== 'NOIMAGE' ? name : undefined,
        color: [0, 0, 0, 0],
        border: [0, 0, 0, 0],
      });
    } else if (items.length && label === 'COLOR') {
      items[items.length - 1].color = rgba(words);
    } else if (items.length && label === 'BORDERCOLOR') {
      items[items.length - 1].border = rgba(words);
    }
  }

  return items;
};

/**
 * One thing a window draws. A slot with an image draws the image; one
 * without draws its `COLOR` and `BORDERCOLOR` as a fill. **[I]** the fill
 * for a slot without an image is inferred, not read from the draw code:
 * mint draws images only, and the colours are what a window without an
 * `IMAGE` slot has left to show.
 */
export interface WndPart {
  role: string;
  image?: string;
  color?: Rgba;
  border?: Rgba;
}

/** A window state that has its own draw data */
export type WndState = 'enabled' | 'hilite' | 'disabled';

/** A window's look in a state; a checked check box has its own, `enabled+checked` */
export type WndLookKey = WndState | `${WndState}+checked`;

/** Every window state, in the order a preview lists the looks */
export const WND_STATES: readonly WndState[] = [
  'enabled',
  'hilite',
  'disabled',
];

type DrawData = ReadonlyMap<string, WndDrawItem[]>;

const drawDataOf = (window: { fields: WndField[] }): DrawData => {
  const data = new Map<string, WndDrawItem[]>();

  for (const field of window.fields) {
    const key = field.key.toUpperCase();

    if (key.endsWith('DRAWDATA')) {
      data.set(key, drawItems(field.value));
    }
  }

  return data;
};

const partOf = (role: string, item: WndDrawItem | undefined) => {
  if (!item) {
    return [];
  }

  if (item.image) {
    return [{ role, image: item.image }];
  }

  return item.color[3] > 0 || item.border[3] > 0
    ? [{ role, color: item.color, border: item.border }]
    : [];
};

/**
 * Lists what a window of `type` draws in `state`, by the slot map of its gadget in
 * mint's `apt-viewer` (`gadget/{check,slider,list,combo}.rs`, from EA's
 * `W3D*` draw code); any other window draws slot 0 of the state's data.
 */
export const partsOf = (
  data: DrawData,
  type: string,
  state: WndState,
  checked = false,
): WndPart[] => {
  const slot = (key: string, index: number) => data.get(key)?.[index];
  const word = state.toUpperCase();
  const own = `${word}DRAWDATA`;
  // A list and a slider have only an enabled and a hilited look
  const pointer = state === 'hilite' ? 'HILITE' : 'ENABLED';

  switch (type.toUpperCase()) {
    case 'CHECKBOX':
      return partOf('box', slot(own, checked ? 2 : 1));
    case 'HORZSLIDER':
    case 'VERTSLIDER':
      return [
        ...partOf('bar-filled', slot('DISABLEDDRAWDATA', 0)),
        ...partOf('bar-empty', slot('DISABLEDDRAWDATA', 1)),
        ...(state === 'hilite'
          ? partOf('outline', slot('HILITEDRAWDATA', 0))
          : []),
        ...partOf('thumb', slot(`SLIDERTHUMB${pointer}DRAWDATA`, 0)),
      ];
    case 'SCROLLLISTBOX': {
      const body = `${pointer}DRAWDATA`;
      const thumb = `SLIDERTHUMB${pointer}DRAWDATA`;
      const selected = slot(body, 1);

      return [
        ...partOf('body', slot(body, 0)),
        ...partOf(
          'selection',
          selected && { ...selected, image: slot(body, 3)?.image },
        ),
        ...partOf('up', slot(`LISTBOX${pointer}UPBUTTONDRAWDATA`, 0)),
        ...partOf('down', slot(`LISTBOX${pointer}DOWNBUTTONDRAWDATA`, 0)),
        ...partOf('track', slot('LISTBOXENABLEDSLIDERDRAWDATA', 0)),
        ...partOf('thumb-top', slot(thumb, 0)),
        ...partOf('thumb-middle', slot(thumb, 5)),
        ...partOf('thumb-bottom', slot(thumb, 6)),
      ];
    }
    case 'COMBOBOX':
      return [
        ...partOf('body', slot(own, 0)),
        ...partOf('button', slot(`COMBOBOXDROPDOWNBUTTON${word}DRAWDATA`, 0)),
      ];
    default:
      return partOf('body', slot(own, 0));
  }
};

/** A window's `FONT` record */
export interface WndFont {
  name: string;
  size: number;
  bold: boolean;
}

/** One window as a preview draws it, resolved from its fields */
export interface WndBox {
  name: string;
  type: string;
  /** Upper left and bottom right, at the creation resolution */
  rect?: [number, number, number, number];
  /** The window's own `CREATIONRESOLUTION` */
  resolution?: [number, number];
  /** As written: a string table label or the text itself */
  text?: string;
  /** The text to draw, through the string table when it names a label */
  shown?: string;
  hidden: boolean;
  /**
   * The engine places this window, as it does a gadget's own parts: it was
   * written at 0 0 outside its parent, so it is drawn inside the parent
   */
  laidOut?: boolean;
  font?: WndFont;
  /** `TEXTCOLOR` per state */
  textColors?: Record<WndState, Rgba>;
  wrapCentered: boolean;
  /** What the window draws in each state */
  looks: Partial<Record<WndLookKey, WndPart[]>>;
  /** First image and colour of the enabled look, for a hover */
  color?: Rgba;
  image?: string;
  /** Where the window starts in the text */
  start: number;
  children: WndBox[];
}

/** Options for `toBoxes` */
export interface BoxOptions {
  /** The text a `TEXT` value shows; `undefined` when it names no string */
  text?: (value: string) => string | undefined;
}

const hasFlag = (field: WndField | undefined, flag: string) =>
  new RegExp(`(^|\\+)\\s*${flag}\\s*($|\\+)`, 'i').test(field?.value ?? '');

const overlaps = (a: number[], b: number[]) =>
  a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const boxOf = (window: WndWindow, options: BoxOptions): WndBox => {
  const rect = fieldOf(window, 'SCREENRECT');
  const items = new Map(rect ? labelled(rect.value) : []);
  const upperLeft = numbers(items.get('UPPERLEFT'));
  const bottomRight = numbers(items.get('BOTTOMRIGHT'));
  const resolution = numbers(items.get('CREATIONRESOLUTION'));
  const type = fieldOf(window, 'WINDOWTYPE')?.value.trim() ?? '';
  const data = drawDataOf(window);
  const looks: WndBox['looks'] = {};

  for (const state of WND_STATES) {
    looks[state] = partsOf(data, type, state);

    if (type.toUpperCase() === 'CHECKBOX') {
      looks[`${state}+checked`] = partsOf(data, type, state, true);
    }
  }

  const font = fieldOf(window, 'FONT');
  const fontItems = new Map(font ? labelled(font.value) : []);
  const fontSize = numbers(fontItems.get('SIZE'))[0];
  const colors = fieldOf(window, 'TEXTCOLOR');
  const colorItems = new Map(colors ? labelled(colors.value) : []);
  const text = fieldOf(window, 'TEXT');
  const written = text && unquote(text.value);
  const enabled = looks.enabled ?? [];

  return {
    name: unquote(fieldOf(window, 'NAME')?.value ?? ''),
    type,
    rect:
      upperLeft.length >= 2 && bottomRight.length >= 2
        ? [upperLeft[0], upperLeft[1], bottomRight[0], bottomRight[1]]
        : undefined,
    resolution:
      resolution.length >= 2 ? [resolution[0], resolution[1]] : undefined,
    text: written,
    shown:
      written === undefined ? undefined : (options.text?.(written) ?? written),
    hidden: hasFlag(fieldOf(window, 'STATUS'), 'HIDDEN'),
    font:
      font && fontSize
        ? {
            name: unquote(fontItems.get('NAME')?.[0] ?? ''),
            size: fontSize,
            bold: numbers(fontItems.get('BOLD'))[0] > 0,
          }
        : undefined,
    textColors: colors && {
      enabled: rgba(colorItems.get('ENABLED')),
      hilite: rgba(colorItems.get('HILITE')),
      disabled: rgba(colorItems.get('DISABLED')),
    },
    wrapCentered: hasFlag(fieldOf(window, 'STATUS'), 'WRAP_CENTERED'),
    looks,
    color: enabled.find((part) => part.color)?.color,
    image: enabled.find((part) => part.image)?.image,
    start: window.start,
    children: [],
  };
};

/**
 * A child the engine places is written at 0 0 and lands outside its parent
 * (a gadget lays out its own scroll bar and buttons). Such a child is moved
 * to its parent's corner when it fits there and hidden when it does not, and
 * a window with no area is hidden.
 */
const settle = (box: WndBox, parent: WndBox | undefined) => {
  if (!box.rect) {
    return;
  }

  const [left, top, right, bottom] = box.rect;

  if (right <= left || bottom <= top) {
    box.hidden = true;

    return;
  }

  if (
    !parent?.rect ||
    left !== 0 ||
    top !== 0 ||
    overlaps(box.rect, parent.rect)
  ) {
    return;
  }

  const [pl, pt, pr, pb] = parent.rect;

  box.laidOut = true;

  if (right - left <= pr - pl && bottom - top <= pb - pt) {
    box.rect = [pl, pt, pl + right - left, pt + bottom - top];
  } else {
    box.hidden = true;
  }
};

/** Converts windows into the boxes a preview draws, placing the children the engine lays out */
export const toBoxes = (
  windows: WndWindow[],
  options: BoxOptions = {},
  parent?: WndBox,
): WndBox[] =>
  windows.map((window) => {
    const box = boxOf(window, options);

    settle(box, parent);
    box.children = toBoxes(window.children, options, box);

    return box;
  });
