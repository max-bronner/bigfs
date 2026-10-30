import type { Matrix2, Rect } from '../aptMovie';
import { buildTree } from './lineTree';
import type { LineNode } from './lineTree';
import {
  BUTTON_STATES,
  TEXT_HEADER,
  impliedPlaceFlags,
  normalizeScript,
} from './textModel';
import type {
  ButtonActionText,
  ButtonRecordText,
  CharacterText,
  FrameText,
  IdSite,
  ItemText,
  MovieText,
  ParsedMovieText,
  Placement,
  ScriptText,
  TextProblem,
  TextRunText,
} from './textModel';
import { composeMatrix } from './numbers';
import {
  Fields,
  ParseError,
  readFloat,
  readFloats,
  i32,
  readInteger,
  u32,
} from './tokenizer';
import type { Token } from './tokenizer';

/** Reads `at x,y`, `scale sx,sy`, `rot deg` and `matrix a,b,c,d` from bare words */
const readPlacement = (
  bare: Token[],
  extra: Record<
    string,
    { arity: number; read: (values: Token[]) => void }
  > = {},
  flags: Record<string, () => void> = {},
  allowPlacement = true,
): Placement | undefined => {
  let translate: [number, number] | undefined;
  let scale: [number, number] | undefined;
  let rotation: number | undefined;
  let matrix: Matrix2 | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < bare.length; index++) {
    const word = bare[index];

    if (word.isString) {
      throw new ParseError(
        'A string here needs a key, as name="..."',
        word.column,
        word.endColumn,
      );
    }
    if (flags[word.text]) {
      flags[word.text]();
      continue;
    }

    const known =
      (allowPlacement &&
        ['at', 'scale', 'rot', 'matrix'].includes(word.text)) ||
      extra[word.text] !== undefined;
    const arity = extra[word.text]?.arity ?? 1;
    const values = bare.slice(index + 1, index + 1 + arity);
    const value = values[0];

    if (!known) {
      throw new ParseError(
        `Unexpected "${word.text}"`,
        word.column,
        word.endColumn,
      );
    }
    if (seen.has(word.text)) {
      throw new ParseError(
        `${word.text} is given twice`,
        word.column,
        word.endColumn,
      );
    }
    if (
      values.length < arity ||
      values.some((each) => each.isString || each.key !== undefined)
    ) {
      throw new ParseError(
        `${word.text} needs ${arity === 1 ? 'a value' : `${arity} values`} after it`,
        word.column,
        word.endColumn,
      );
    }
    seen.add(word.text);
    index += arity;

    switch (word.text) {
      case 'at':
        translate = readFloats(value, 2, 'at') as [number, number];
        break;
      case 'scale':
        scale = readFloats(value, 2, 'scale') as [number, number];
        break;
      case 'rot':
        // Degrees are not stored, so they are read at full precision
        readFloats(value, 1, 'rot');
        rotation = Number(value.text);
        break;
      case 'matrix':
        matrix = readFloats(value, 4, 'matrix') as Matrix2;
        break;
      default:
        extra[word.text].read(values);
    }
  }

  if (matrix && (scale || rotation !== undefined)) {
    throw new ParseError(
      'matrix replaces scale and rot; give one or the other',
    );
  }
  if (!translate && !scale && rotation === undefined && !matrix) {
    return undefined;
  }
  return {
    translate: translate ?? [0, 0],
    matrix:
      matrix ??
      (rotation !== undefined
        ? composeMatrix(scale?.[0] ?? 1, scale?.[1] ?? 1, rotation)
        : [scale?.[0] ?? 1, 0, 0, scale?.[1] ?? 1]),
  };
};

/** Reads the model back from text, collecting every problem rather than stopping at the first */
export const parseMovieText = (text: string): ParsedMovieText => {
  const lines = text.split(/\r?\n/);
  const problems: TextProblem[] = [];
  const ids: IdSite[] = [];
  const movie: MovieText = {
    constants: [],
    imports: [],
    exports: [],
    characters: [],
  };

  const firstLine = lines.findIndex(
    (line) => line.trim() && !line.trim().startsWith(';'),
  );

  if (firstLine < 0 || lines[firstLine].trim() !== TEXT_HEADER) {
    problems.push({
      line: Math.max(0, firstLine),
      column: 0,
      endColumn: lines[Math.max(0, firstLine)]?.length ?? 0,
      message: `The text must start with "${TEXT_HEADER}"`,
    });
    return { movie, problems, ids };
  }

  const nodes = buildTree(lines.slice(), problems).filter(
    (node) => node.line !== firstLine,
  );

  // Runs a reader over one node, turning a failure into a problem there
  const attempt = <T>(node: LineNode, read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      const failure =
        error instanceof ParseError ? error : new ParseError(String(error));

      problems.push({
        line: node.line,
        column: failure.endColumn ? failure.column : node.indent,
        endColumn: failure.endColumn || lines[node.line].length,
        message: failure.message,
      });
      return undefined;
    }
  };

  const readId = (token: Token, isDeclaration = false): number => {
    const value = u32(token, 'A character id');
    const offset = token.key !== undefined ? token.key.length + 1 : 0;

    ids.push({
      id: value,
      line: currentLine,
      column: token.column + offset,
      endColumn: token.endColumn,
      isDeclaration,
    });
    return value;
  };
  let currentLine = 0;

  const reportChildren = (node: LineNode, what: string) => {
    for (const child of node.children) {
      problems.push({
        line: child.line,
        column: child.indent,
        endColumn: lines[child.line].length,
        message: `${what} holds nothing indented under it`,
      });
    }
  };

  const keyword = (node: LineNode) =>
    node.fence ? '```' : node.tokens[0]?.text;

  const readScript = (node: LineNode, what: string): ScriptText | undefined => {
    const fences = node.children.filter((child) => child.fence);
    const others = node.children.filter((child) => !child.fence);

    for (const other of others) {
      problems.push({
        line: other.line,
        column: other.indent,
        endColumn: lines[other.line].length,
        message: `${what} holds only its script fence`,
      });
    }
    if (fences.length !== 1) {
      problems.push({
        line: (fences[1] ?? node).line,
        column: node.indent,
        endColumn: lines[node.line].length,
        message: `${what} needs exactly one \`\`\` fence holding its script`,
      });
      return undefined;
    }

    const fence = fences[0].fence!;

    if (!['as', 'asm', 'listing'].includes(fence.mode)) {
      problems.push({
        line: fences[0].line,
        column: fences[0].indent,
        endColumn: lines[fences[0].line].length,
        message: 'A fence is ```as, ```asm or ```listing',
      });
      return undefined;
    }
    return {
      mode: fence.mode as ScriptText['mode'],
      text: normalizeScript(fence.text),
      line: fences[0].line,
    };
  };

  const readItem = (node: LineNode, frame: number): ItemText | undefined => {
    currentLine = node.line;

    const [head, ...rest] = node.tokens;
    const origin = { line: node.line, endLine: node.endLine };

    switch (head?.text) {
      case 'action': {
        const fields = new Fields(rest, 'action');

        fields.finish();
        if (fields.bare.length) {
          throw new ParseError('A frame action takes no fields');
        }

        const script = readScript(node, 'An action');

        return script && { ...origin, type: 'action', script };
      }
      case 'label': {
        reportChildren(node, 'A label');

        const [name, ...more] = rest;

        if (!name?.isString || name.key !== undefined) {
          throw new ParseError('label takes its name in quotes');
        }

        const fields = new Fields(more, 'label');
        const flags = fields.getOptional('flags');
        const at = fields.getOptional('frame');

        fields.finish();
        if (fields.bare.length) {
          throw new ParseError(
            `Unexpected "${fields.bare[0].text}"`,
            fields.bare[0].column,
            fields.bare[0].endColumn,
          );
        }
        return {
          ...origin,
          type: 'label',
          label: name.text,
          flags: flags ? u32(flags, 'flags') : 0,
          frame: at ? u32(at, 'frame') : frame,
        };
      }
      case 'place': {
        const fields = new Fields(rest, 'place');
        const depth = i32(fields.getRequired('depth', node.tokens), 'depth');
        const character = fields.getOptional('char');
        const name = fields.getString('name');
        const ratio = fields.getOptional('ratio');
        const clip = fields.getOptional('clip');
        const flags = fields.getOptional('flags');
        let isMove = false;
        let color: [number, number] | undefined;

        fields.finish();

        const readColor = ([multiply, add]: Token[]) => {
          if (!multiply.text.startsWith('*') || !add.text.startsWith('+')) {
            throw new ParseError(
              'color takes *r,g,b,a then +r,g,b,a',
              multiply.column,
              add.endColumn,
            );
          }

          const bytes = (token: Token) => {
            const parts = token.text.slice(1).split(',');

            if (parts.length !== 4) {
              throw new ParseError(
                'A colour term is four bytes, r,g,b,a',
                token.column,
                token.endColumn,
              );
            }
            return parts.map((part) =>
              readInteger({ ...token, text: part }, 0, 255, 'A colour byte'),
            );
          };
          const [r, g, b, a] = bytes(multiply);
          const [ar, ag, ab, aa] = bytes(add);

          color = [
            (r | (g << 8) | (b << 16) | (a << 24)) >>> 0,
            ((ar << 16) | (ag << 8) | ab | (aa << 24)) >>> 0,
          ];
        };
        const placement = readPlacement(
          fields.bare,
          { color: { arity: 2, read: readColor } },
          { move: () => (isMove = true) },
        );

        const clipActions = node.children.length
          ? node.children.map((child) => {
              currentLine = child.line;

              const [word, ...more] = child.tokens;

              if (word?.text !== 'action') {
                throw new ParseError(
                  'A placement holds only its clip actions, action events=...',
                );
              }

              const actionFields = new Fields(more, 'A clip action');
              const events = u32(
                actionFields.getRequired('events', child.tokens),
                'events',
              );

              actionFields.finish();

              const script = readScript(child, 'A clip action');

              if (!script) {
                throw new ParseError('A clip action needs its script');
              }
              return {
                line: child.line,
                endLine: child.endLine,
                events,
                script,
              };
            })
          : undefined;
        currentLine = node.line;

        const item: Extract<ItemText, { type: 'place' }> = {
          ...origin,
          type: 'place',
          flags: 0,
          depth,
          character: character && readId(character),
          placement,
          colorTransform: color?.[0],
          colorAdd: color?.[1],
          ratio: ratio && readFloat(ratio.text, ratio, 'ratio'),
          name,
          clipDepth: clip && i32(clip, 'clip'),
          clipActions,
        };

        item.flags = flags
          ? u32(flags, 'flags')
          : impliedPlaceFlags(item, isMove);
        return item;
      }
      case 'remove': {
        reportChildren(node, 'A remove');

        const fields = new Fields(rest, 'remove');
        const depth = i32(fields.getRequired('depth', node.tokens), 'depth');

        fields.finish();
        return { ...origin, type: 'remove', depth };
      }
      case 'bg': {
        reportChildren(node, 'A background colour');

        const color = rest[0];

        if (!color || rest.length > 1 || !/^#[0-9a-f]{8}$/i.test(color.text)) {
          throw new ParseError('bg takes a colour, #rrggbbaa');
        }

        const bytes = [1, 3, 5, 7].map((at) =>
          parseInt(color.text.slice(at, at + 2), 16),
        );

        return {
          ...origin,
          type: 'background',
          color:
            (bytes[0] |
              (bytes[1] << 8) |
              (bytes[2] << 16) |
              (bytes[3] << 24)) >>>
            0,
        };
      }
      case 'initaction': {
        const fields = new Fields(rest, 'initaction');
        const sprite = readId(fields.getRequired('sprite', node.tokens));

        fields.finish();

        const script = readScript(node, 'An init action');

        return script && { ...origin, type: 'initAction', sprite, script };
      }
      case 'unknown': {
        reportChildren(node, 'An unknown item');

        const fields = new Fields(rest, 'unknown');
        const type = u32(fields.getRequired('type', node.tokens), 'type');

        fields.finish();
        return { ...origin, type: 'unknown', itemType: type };
      }
      default:
        throw new ParseError(
          `A frame holds action, label, place, remove, bg, initaction or unknown, not "${head?.text ?? ''}"`,
        );
    }
  };

  const readFrames = (node: LineNode): FrameText[] => {
    const frames: FrameText[] = [];

    for (const child of node.children) {
      attempt(child, () => {
        currentLine = child.line;

        const [word, number, title, ...more] = child.tokens;

        if (word?.text !== 'frame' || !number) {
          throw new ParseError('A timeline holds frame blocks: frame <n>');
        }

        const index = u32(number, 'A frame number');

        if (index !== frames.length) {
          throw new ParseError(
            `Frames are numbered in order from 0; this one should be ${frames.length}`,
            number.column,
            number.endColumn,
          );
        }
        if (more.length || (title && (!title.isString || title.key))) {
          throw new ParseError(
            'A frame line is frame <n> or frame <n> "label"',
          );
        }

        const frame: FrameText = {
          index,
          line: child.line,
          endLine: child.endLine,
          items: title
            ? [
                {
                  line: child.line,
                  type: 'label',
                  label: title.text,
                  flags: 0,
                  frame: index,
                },
              ]
            : [],
        };

        frames.push(frame);
        for (const itemNode of child.children) {
          const item = attempt(itemNode, () => readItem(itemNode, index));

          if (item) {
            frame.items.push(item);
          }
        }
      });
    }
    return frames;
  };

  const readCharacter = (node: LineNode): CharacterText | undefined => {
    const [, idToken, typeToken, ...rest] = node.tokens;

    if (!idToken || !typeToken) {
      throw new ParseError('A character line is character <id> <type> ...');
    }

    const head = {
      id: readId(idToken, true),
      line: node.line,
      endLine: node.endLine,
    };
    const fields = new Fields(rest, typeToken.text);
    const rect = (key: string) =>
      readFloats(fields.getRequired(key, node.tokens), 4, key) as Rect;
    const number = (key: string) => u32(fields.getRequired(key, node.tokens), key);
    const float = (key: string) => {
      const token = fields.getRequired(key, node.tokens);

      return readFloat(token.text, token, key);
    };
    const done = <T>(character: T): T => {
      fields.finish();
      if (fields.bare.length) {
        throw new ParseError(
          `Unexpected "${fields.bare[0].text}"`,
          fields.bare[0].column,
          fields.bare[0].endColumn,
        );
      }
      return character;
    };
    const flat = <T>(character: T): T => {
      reportChildren(node, `A ${typeToken.text}`);
      return done(character);
    };

    switch (typeToken.text) {
      case 'movie': {
        const screen = fields.getOptional('screen');
        const unknown36 = fields.getOptional('unknown36');
        let size:
          | { width: number; height: number; unknown36: number }
          | undefined;

        if (screen) {
          const match = /^(\d+)x(\d+)$/.exec(screen.text);

          if (!match) {
            throw new ParseError(
              'screen takes <width>x<height>',
              screen.column,
              screen.endColumn,
            );
          }
          size = {
            width: u32({ ...screen, text: match[1] }, 'The width'),
            height: u32({ ...screen, text: match[2] }, 'The height'),
            unknown36: unknown36 ? u32(unknown36, 'unknown36') : 33,
          };
        }
        done(undefined);
        return {
          ...head,
          type: 'movie',
          screen: size,
          frames: readFrames(node),
        };
      }
      case 'shape':
        return flat({
          ...head,
          type: 'shape',
          bounds: rect('bounds'),
          geometry: number('geometry'),
        });
      case 'edittext': {
        const colorToken = fields.getRequired('color', node.tokens);

        if (!/^#[0-9a-f]{8}$/i.test(colorToken.text)) {
          throw new ParseError(
            'color takes #rrggbbaa',
            colorToken.column,
            colorToken.endColumn,
          );
        }

        const [r, g, b, a] = [1, 3, 5, 7].map((at) =>
          parseInt(colorToken.text.slice(at, at + 2), 16),
        );
        const fontToken = fields.getRequired('font', node.tokens);

        return flat({
          ...head,
          type: 'editText',
          bounds: rect('bounds'),
          font: readId(fontToken),
          alignment: number('align'),
          color: ((a << 24) | (r << 16) | (g << 8) | b) >>> 0,
          fontHeight: float('height'),
          readonly: number('readonly'),
          multiline: number('multiline'),
          wordwrap: number('wordwrap'),
          text: fields.getString('text'),
          variable: fields.getString('var'),
        });
      }
      case 'font': {
        const glyphs = fields.getOptional('glyphs');

        return flat({
          ...head,
          type: 'font',
          name: fields.getString('name'),
          glyphs: glyphs?.text
            ? glyphs.text
                .split(',')
                .map((part) => u32({ ...glyphs, text: part }, 'A glyph'))
            : [],
        });
      }
      case 'button': {
        const bounds = rect('bounds');
        const hitTriangles = number('hit-triangles');
        const records: ButtonRecordText[] = [];
        const actions: ButtonActionText[] = [];

        done(undefined);
        for (const child of node.children) {
          attempt(child, () => {
            currentLine = child.line;

            const [word, ...more] = child.tokens;
            const childFields = new Fields(more, word?.text ?? '');

            if (word?.text === 'record') {
              reportChildren(child, 'A button record');

              const states = childFields.getRequired('states', child.tokens);
              const flags =
                states.text === 'none'
                  ? 0
                  : states.text.split(',').reduce((sum, part) => {
                      const bit = BUTTON_STATES.indexOf(part);

                      return (
                        sum |
                        (bit >= 0
                          ? 1 << bit
                          : u32({ ...states, text: part }, 'A state'))
                      );
                    }, 0) >>> 0;
              const depth = i32(
                childFields.getRequired('depth', child.tokens),
                'depth',
              );
              const character = readId(childFields.getRequired('char', child.tokens));
              let color = [1, 1, 1, 1];
              let unknown = [0, 0, 0, 0];

              childFields.finish();

              const placement = readPlacement(childFields.bare, {
                color: {
                  arity: 1,
                  read: ([value]) => (color = readFloats(value, 4, 'color')),
                },
                unknown: {
                  arity: 1,
                  read: ([value]) => (unknown = readFloats(value, 4, 'unknown')),
                },
              });

              records.push({
                line: child.line,
                endLine: child.endLine,
                flags,
                depth,
                character,
                placement: placement ?? {
                  matrix: [1, 0, 0, 1],
                  translate: [0, 0],
                },
                color: color as ButtonRecordText['color'],
                unknown: unknown as ButtonRecordText['unknown'],
              });
            } else if (word?.text === 'action') {
              const condition = u32(
                childFields.getRequired('condition', child.tokens),
                'condition',
              );

              childFields.finish();

              const script = readScript(child, 'A button action');

              if (script) {
                actions.push({
                  line: child.line,
                  endLine: child.endLine,
                  condition,
                  script,
                });
              }
            } else {
              throw new ParseError('A button holds record and action lines');
            }
          });
        }
        return {
          ...head,
          type: 'button',
          bounds,
          hitTriangles,
          records,
          actions,
        };
      }
      case 'sprite':
        done(undefined);
        return { ...head, type: 'sprite', frames: readFrames(node) };
      case 'image':
        return flat({ ...head, type: 'image', texture: number('texture') });
      case 'morph':
        return flat({
          ...head,
          type: 'morph',
          startShape: readId(fields.getRequired('start', node.tokens)),
          endShape: readId(fields.getRequired('end', node.tokens)),
        });
      case 'text': {
        const bounds = rect('bounds');

        fields.finish();

        const placement = readPlacement(fields.bare) ?? {
          matrix: [1, 0, 0, 1],
          translate: [0, 0],
        };
        const runs: TextRunText[] = [];

        for (const child of node.children) {
          attempt(child, () => {
            currentLine = child.line;

            const [word, ...more] = child.tokens;

            if (word?.text !== 'run') {
              throw new ParseError('A text holds run lines');
            }
            reportChildren(child, 'A run');

            const runFields = new Fields(more, 'run');
            const font = readId(runFields.getRequired('font', child.tokens));
            const height = runFields.getRequired('height', child.tokens);
            const glyphs = runFields.getOptional('glyphs');
            let color: number[] | undefined;
            let unknown = [0, 0, 0, 0];
            let pen: number[] | undefined;

            runFields.finish();
            readPlacement(
              runFields.bare,
              {
                color: {
                  arity: 1,
                  read: ([value]) => (color = readFloats(value, 4, 'color')),
                },
                unknown: {
                  arity: 1,
                  read: ([value]) => (unknown = readFloats(value, 4, 'unknown')),
                },
                pen: {
                  arity: 1,
                  read: ([value]) => (pen = readFloats(value, 2, 'pen')),
                },
              },
              {},
              false,
            );
            if (!color || !pen) {
              throw new ParseError('A run needs color r,g,b,a and pen x,y');
            }
            runs.push({
              line: child.line,
              endLine: child.endLine,
              font,
              color: color as TextRunText['color'],
              unknown: unknown as Rect,
              penOffset: pen as [number, number],
              textHeight: readFloat(height.text, height, 'height'),
              glyphs: glyphs?.text
                ? glyphs.text.split(',').map((part) => {
                    const match = /^(\d+):(-?\d+)$/.exec(part);

                    if (!match) {
                      throw new ParseError(
                        'A glyph is <index>:<advance>',
                        glyphs.column,
                        glyphs.endColumn,
                      );
                    }
                    return {
                      index: u32(
                        { ...glyphs, text: match[1] },
                        'A glyph index',
                      ),
                      advance: i32({ ...glyphs, text: match[2] }, 'An advance'),
                    };
                  })
                : [],
            });
          });
        }
        return { ...head, type: 'text', bounds, placement, runs };
      }
      case 'placeholder':
        return flat({ ...head, type: 'placeholder' });
      case 'unknown':
        return flat({
          ...head,
          type: 'unknown',
          characterType: number('type'),
        });
      default:
        throw new ParseError(
          `"${typeToken.text}" is not a character type`,
          typeToken.column,
          typeToken.endColumn,
        );
    }
  };

  let characterCount = 0;

  for (const node of nodes) {
    currentLine = node.line;

    switch (keyword(node)) {
      case 'const':
        attempt(node, () => {
          if (node.tokens.length > 1) {
            throw new ParseError('const holds its items indented under it');
          }
        });
        for (const child of node.children) {
          const item = attempt(child, () => {
            const [index, value, ...more] = child.tokens;

            if (!index || !value || more.length || index.key || value.key) {
              throw new ParseError(
                'A constant is <index> "string" or <index> <number>',
              );
            }

            const at = u32(index, 'A constant index');

            if (at !== movie.constants.length) {
              throw new ParseError(
                `Constants are numbered in order from 0; this one should be ${movie.constants.length}`,
                index.column,
                index.endColumn,
              );
            }
            reportChildren(child, 'A constant');
            return {
              line: child.line,
              index: at,
              value: value.isString
                ? value.text
                : u32(value, 'A number constant'),
            };
          });

          if (item) {
            movie.constants.push(item);
          }
        }
        break;
      case 'import':
        attempt(node, () => {
          const [, character, from, name, ...more] = node.tokens;

          reportChildren(node, 'An import');
          if (!character || !from?.isString || !name?.isString || more.length) {
            throw new ParseError('An import is import <id> "movie" "name"');
          }
          movie.imports.push({
            line: node.line,
            character: readId(character),
            movie: from.text,
            name: name.text,
          });
        });
        break;
      case 'export':
        attempt(node, () => {
          const [, character, name, ...more] = node.tokens;

          reportChildren(node, 'An export');
          if (!character || !name?.isString || more.length) {
            throw new ParseError('An export is export <id> "name"');
          }
          movie.exports.push({
            line: node.line,
            character: readId(character),
            name: name.text,
          });
        });
        break;
      case 'character': {
        const expected = characterCount++;
        const character = attempt(node, () => readCharacter(node));

        if (character && character.id !== expected) {
          problems.push({
            line: node.line,
            column: node.tokens[1].column,
            endColumn: node.tokens[1].endColumn,
            message: `Characters are listed by id from 0; this one should be ${expected}`,
          });
        } else if (character) {
          movie.characters.push(character);
        }
        break;
      }
      default:
        problems.push({
          line: node.line,
          column: node.indent,
          endColumn: lines[node.line].length,
          message: `Expected const, import, export or character, not "${keyword(node) ?? ''}"`,
        });
    }
  }

  return { movie, problems, ids };
};
