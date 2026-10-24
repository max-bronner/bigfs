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

export interface WndField {
  key: string;
  value: string;
  /** From the key to past the `;` */
  start: number;
  end: number;
  keyEnd: number;
}

export interface WndWindow {
  fields: WndField[];
  children: WndWindow[];
  /** From `WINDOW` to past its `END` */
  start: number;
  end: number;
}

export interface WndProblem {
  start: number;
  end: number;
  message: string;
}

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

/** A window's field by key, without casing */
export const fieldOf = (
  window: { fields: WndField[] },
  key: string,
): WndField | undefined =>
  window.fields.find((field) => field.key.toUpperCase() === key);

/**
 * `LABEL: value` items, tokenised as EA's `strtok` over ` :,` does, so a
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

/** What a preview needs of one window */
export interface WndBox {
  name: string;
  type: string;
  /** Upper left and bottom right, at the creation resolution */
  rect?: [number, number, number, number];
  resolution?: [number, number];
  text?: string;
  hidden: boolean;
  /** First enabled draw colour and image, for a fill */
  color?: [number, number, number, number];
  image?: string;
  /** Where the window starts in the text */
  start: number;
  children: WndBox[];
}

const unquote = (value: string) => value.trim().replace(/^"(.*)"$/, '$1');

/** The boxes a preview draws */
export const toBoxes = (windows: WndWindow[]): WndBox[] =>
  windows.map((window) => {
    const rect = fieldOf(window, 'SCREENRECT');
    const items = new Map(rect ? labelled(rect.value) : []);
    const upperLeft = numbers(items.get('UPPERLEFT'));
    const bottomRight = numbers(items.get('BOTTOMRIGHT'));
    const resolution = numbers(items.get('CREATIONRESOLUTION'));
    const draw = fieldOf(window, 'ENABLEDDRAWDATA');
    const drawItems = draw ? labelled(draw.value) : [];
    const image = drawItems.find(([label]) => label === 'IMAGE')?.[1][0];
    const color = numbers(drawItems.find(([label]) => label === 'COLOR')?.[1]);

    return {
      name: unquote(fieldOf(window, 'NAME')?.value ?? ''),
      type: fieldOf(window, 'WINDOWTYPE')?.value.trim() ?? '',
      rect:
        upperLeft.length >= 2 && bottomRight.length >= 2
          ? [upperLeft[0], upperLeft[1], bottomRight[0], bottomRight[1]]
          : undefined,
      resolution:
        resolution.length >= 2 ? [resolution[0], resolution[1]] : undefined,
      text: fieldOf(window, 'TEXT')
        ? unquote(fieldOf(window, 'TEXT')?.value ?? '')
        : undefined,
      hidden: /(^|\+)\s*HIDDEN\s*($|\+)/i.test(
        fieldOf(window, 'STATUS')?.value ?? '',
      ),
      color:
        color.length >= 4
          ? [color[0], color[1], color[2], color[3]]
          : undefined,
      image: image && image.toUpperCase() !== 'NOIMAGE' ? image : undefined,
      start: window.start,
      children: toBoxes(window.children),
    };
  });
