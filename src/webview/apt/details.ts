import type { Character, Frame } from '../../formats/apt/aptMovie';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { AptEdit } from '../../formats/apt/writer/aptEdit';
import { byId } from './dom';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromPage } from './protocol';
import { BUTTON_CONDITIONS, CLIP_EVENTS, formatBitNames } from './scriptSites';
import { movie, state } from './state';
import { TYPE_NAMES, describeCharacter } from './describeCharacter';
import { findMovieNamed, resolve } from './resolve';
import { getFrames } from './timeline';
import { addMenu } from './blocks/addMenu';
import { blockCard, reorderList } from './blocks/blockCard';
import { addChoices, kindOfCharacter, moveTarget } from './blocks/blockModel';
import {
  action,
  characterPicker,
  colourField,
  createField,
  flagToggles,
  hexField,
  listField,
  numberField,
  createSection,
  text,
  textField,
  tupleFields,
} from './blocks/controls';
import { scriptBlock } from './blocks/scriptBlock';
import {
  BUTTON_STATES,
  buttonConditionToggles,
  buttonRecordBlock,
  frameItemBlock,
  textRunBlock,
} from './recordFields';

export { showScript } from './blocks/scriptBlock';

const vscode = getVsCodeApi<FromPage>();

const details = byId('details');
const frameInput = byId<HTMLInputElement>('frame');

/** Sends an edit; the extension applies it and sends the movie back */
export const send = (edit: AptEdit): void =>
  vscode.postMessage({ kind: 'edit', edit });

/** Name of the window event that asks the page to show a frame of the timeline on the stage */
export const GO_TO_FRAME = 'apt-go-to-frame';

/** The scripts of a character's other frames and its buttons, which the shown frame does not list */
const scriptsOutsideFrame = (character: Character) => {
  const timeline = character.id;
  const sites: Parameters<typeof scriptBlock>[0][] = [];

  getFrames(movie(), character).forEach((frame, index) => {
    if (index === state.frame) {
      return;
    }
    for (const item of frame.items) {
      if (item.type === 'action' || item.type === 'initAction') {
        sites.push({
          label:
            item.type === 'action'
              ? `frame ${index}`
              : `frame ${index} init #${item.sprite}`,
          block: item.block,
          tab: `${movie().name} #${timeline} frame ${index}`,
          remove: {
            kind: 'removeItem',
            timeline,
            frame: index,
            offset: item.offset,
          },
        });
      }
      if (item.type === 'placeObject') {
        (item.clipActions ?? []).forEach((clip, clipIndex) =>
          sites.push({
            label: `frame ${index} @${item.depth} on ${formatBitNames(clip.events, CLIP_EVENTS)}`,
            block: clip.block,
            tab: `${movie().name} #${timeline} frame ${index} @${item.depth}`,
            remove: {
              kind: 'removeClipAction',
              offset: item.offset,
              index: clipIndex,
            },
          }),
        );
      }
    }
  });
  return sites;
};

/** Ways to attach a new script to the selected character */
const addScript = (
  to: Extract<FromPage, { kind: 'addScript' }>['to'],
  label: string,
): void =>
  vscode.postMessage({
    kind: 'addScript',
    to,
    label: `${movie().name} ${label}`,
  });

const bounds = (
  character: Extract<Character, { bounds: unknown }>,
  change: (field: string) => (value: unknown) => void,
) =>
  createField(
    'Bounds',
    tupleFields(
      [...character.bounds] as number[],
      ['left', 'top', 'right', 'bottom'],
      change('bounds'),
    ),
  );

/** The `.const` items: a string or a number each, either editable */
const constantBlocks = (): HTMLElement => {
  const items = movie().consts ?? [];
  const constEdit = (index: number, value: string | number) =>
    vscode.postMessage({ kind: 'constEdit', change: { index, value } });

  return blockCard({
    key: 'consts',
    kind: 'constant',
    title: 'Constants',
    summary: `${items.length} items`,
    body: () =>
      items.map((value, index) => {
        const kind = document.createElement('select');

        kind.className = 'bk-select';
        kind.add(
          new Option('string', 'string', false, typeof value === 'string'),
        );
        kind.add(
          new Option('number', 'number', false, typeof value === 'number'),
        );
        kind.onchange = () =>
          constEdit(
            index,
            kind.value === 'string' ? String(value) : Number(value) >>> 0 || 0,
          );

        return blockCard({
          key: `const:${index}`,
          kind: 'constant',
          title: `#${index}`,
          summary: String(value).slice(0, 40),
          body: () => [
            createField(
              'Value',
              kind,
              typeof value === 'string'
                ? textField(value, (next) => constEdit(index, next))
                : numberField(value, (next) => constEdit(index, next)),
            ),
          ],
        });
      }),
  });
};

/** Where an import comes from, and what it resolves to there */
const importSource = (character: Character): HTMLElement[] => {
  const entry = movie().imports.find((each) => each.character === character.id);

  if (!entry) {
    return [createField('Import', text('no import fills this slot'))];
  }

  const target = findMovieNamed(entry.movie);
  const resolved = resolve(movie(), character.id);
  const exported = target?.exports.find(
    (each) => each.name.toLowerCase() === entry.name.toLowerCase(),
  );

  return [
    createField(
      'From',
      text(
        target
          ? `${target.name}${target.origin ? ' · ' + target.origin : ''}`
          : `${entry.movie}: no install holds this movie`,
      ),
      ...(target
        ? [
            action('Open', () =>
              vscode.postMessage({ kind: 'openMovie', name: entry.movie }),
            ),
          ]
        : []),
    ),
    createField(
      'Export',
      text(
        resolved
          ? `${entry.name} → #${exported!.character} ${TYPE_NAMES[resolved.character.type]}` +
              (resolved.movie !== target ? ` in ${resolved.movie.name}` : '')
          : target && !exported
            ? `${entry.name}: ${target.name} exports no such name`
            : entry.name,
      ),
    ),
  ];
};

/** The Movie record: screen, exports, imports, constants and the characters it can add */
const movieBody = (character: Extract<Character, { type: 'movie' }>) => {
  const source = movie();
  const size = [character.record.screenWidth, character.record.screenHeight];

  const exports = source.exports.map((entry, index) =>
    blockCard({
      key: `export:${index}`,
      kind: 'export',
      title: entry.name,
      summary: `→ #${entry.character}`,
      onRemove: () => send({ kind: 'removeExport', index }),
      body: () => [
        createField(
          'Name',
          textField(entry.name, (name) =>
            send({ kind: 'export', index, name }),
          ),
        ),
        createField(
          'Character',
          characterPicker(entry.character, (value) =>
            send({ kind: 'export', index, character: value }),
          ),
        ),
      ],
    }),
  );
  const imports = source.imports.map((entry, index) =>
    blockCard({
      key: `import:${index}`,
      kind: 'import',
      title: `${entry.movie}:${entry.name}`,
      summary: `slot #${entry.character}`,
      onRemove: () => send({ kind: 'removeImport', index }),
      body: () => [
        createField(
          'Movie',
          textField(entry.movie, (value) =>
            send({ kind: 'import', index, movie: value }),
          ),
        ),
        createField(
          'Name',
          textField(entry.name, (name) =>
            send({ kind: 'import', index, name }),
          ),
        ),
        createField(
          'Slot',
          numberField(entry.character, (value) =>
            send({ kind: 'import', index, character: value }),
          ),
        ),
      ],
    }),
  );
  const add = (id: string) => {
    if (id === 'export') {
      send({
        kind: 'addExport',
        name: `Export${source.exports.length + 1}`,
        character: 1,
      });
    } else if (id === 'import') {
      send({ kind: 'addImport', movie: 'movie', name: 'name' });
    } else {
      send({ kind: 'addCharacter', type: id as 'editText' });
    }
  };

  return [
    createField(
      'Screen',
      tupleFields(size, ['width', 'height'], ([width, height]) =>
        send({ kind: 'screen', width, height }),
      ),
    ),
    createField(
      'Word +36',
      numberField(character.record.unknown36, (value) =>
        send({ kind: 'movieUnknown36', value }),
      ),
    ),
    createField(
      'Movie',
      action('Rename movie…', () =>
        vscode.postMessage({ kind: 'manageMovie', action: 'rename' }),
      ),
      action('Delete movie…', () =>
        vscode.postMessage({ kind: 'manageMovie', action: 'delete' }),
      ),
    ),
    createSection(`Exports (${exports.length})`),
    ...exports,
    createSection(`Imports (${imports.length})`),
    ...imports,
    constantBlocks(),
    addMenu('Add block', addChoices('movie'), add),
  ];
};

/** The block fields of a character, by type */
const characterBody = (character: Character): Node[] => {
  const change =
    (name: string) =>
    (value: unknown): void =>
      send({
        kind: 'character',
        id: character.id,
        change: { field: name, value },
      } as AptEdit);
  const fields: Node[] = [];

  if ('bounds' in character) {
    fields.push(bounds(character, change));
  }
  switch (character.type) {
    case 'editText': {
      const argb = character.color >>> 0;

      fields.push(
        createField(
          'Text',
          textField(character.text ?? '', (value) =>
            change('text')(value === '' ? undefined : value),
          ),
        ),
        createField(
          'Variable',
          textField(character.variable ?? '', (value) =>
            change('variable')(value.trim() === '' ? undefined : value.trim()),
          ),
        ),
        createField(
          'Colour',
          colourField(
            [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, argb >>> 24],
            ([r, g, b, a]) =>
              change('color')(((a << 24) | (r << 16) | (g << 8) | b) >>> 0),
          ),
          hexField(argb, change('color')),
        ),
        createField(
          'Font height',
          numberField(character.fontHeight, change('fontHeight')),
        ),
        createField('Font', characterPicker(character.font, change('font'))),
        createField(
          'Alignment',
          numberField(character.alignment, change('alignment')),
        ),
        createField(
          'Style',
          flagToggles(
            [
              ['readonly', 1],
              ['multiline', 2],
              ['wordwrap', 4],
            ],
            (character.readonly ? 1 : 0) |
              (character.multiline ? 2 : 0) |
              (character.wordwrap ? 4 : 0),
            (word) => {
              for (const [name, bit] of [
                ['readonly', 1],
                ['multiline', 2],
                ['wordwrap', 4],
              ] as const) {
                if (!!(word & bit) !== !!character[name]) {
                  change(name)(word & bit ? 1 : 0);
                }
              }
            },
          ),
        ),
      );
      break;
    }
    case 'font':
      fields.push(
        createField(
          'Font name',
          textField(character.name ?? '', (value) =>
            change('fontName')(value || undefined),
          ),
        ),
        createField(
          'Glyph ids',
          listField(character.glyphs.join(', '), 1, (ids) =>
            change('glyphs')(ids.map(([id]) => id)),
          ),
        ),
      );
      break;
    case 'morph':
      fields.push(
        createField(
          'Start shape',
          characterPicker(character.startShape, change('startShape')),
        ),
        createField(
          'End shape',
          characterPicker(character.endShape, change('endShape')),
        ),
      );
      break;
    case 'text': {
      const font =
        character.records[0]?.font ??
        movie().characters.find((each) => each.type === 'font')?.id ??
        1;

      fields.push(
        createField(
          'Matrix',
          tupleFields(
            [...character.matrix, ...character.translate],
            ['a', 'b', 'c', 'd', 'x', 'y'],
            (values) => {
              const was = [...character.matrix, ...character.translate];

              // One edit for the part that changed, so one undo takes it back
              if (
                values.slice(0, 4).some((value, index) => value !== was[index])
              ) {
                change('matrix')(values.slice(0, 4));
              } else {
                change('translate')(values.slice(4));
              }
            },
          ),
        ),
        createSection(`Text runs (${character.records.length})`),
        ...character.records.map((record, index) =>
          textRunBlock(character, record, index),
        ),
        addMenu('Add block', addChoices('text'), () =>
          send({ kind: 'addTextRecord', id: character.id, font }),
        ),
      );
      break;
    }
    case 'sprite':
      fields.push(createField('Frames', text(String(character.frameCount))));
      break;
    case 'image':
      fields.push(
        createField('Texture id', numberField(character.texture, change('texture'))),
      );
      break;
    case 'shape':
      fields.push(
        createField(
          'Geometry',
          numberField(character.geometry, change('geometry')),
          action('Open .ru', () =>
            vscode.postMessage({
              kind: 'openGeometry',
              geometry: character.geometry,
            }),
          ),
        ),
      );
      break;
    case 'button': {
      const depth =
        Math.max(0, ...character.records.map((record) => record.depth)) + 1;
      const records = reorderList(
        Object.assign(document.createElement('div'), {}),
        (from, to) =>
          send({
            kind: 'moveButtonRecord',
            id: character.id,
            from,
            to: moveTarget(character.records.length, from, to),
          }),
      );
      const actions = character.actions.map((entry, index) =>
        scriptBlock({
          label: `on ${formatBitNames(entry.condition, BUTTON_CONDITIONS)}`,
          block: entry.block,
          tab: `${movie().name} #${character.id} on ${formatBitNames(entry.condition, BUTTON_CONDITIONS)}`,
          remove: { kind: 'removeButtonAction', id: character.id, index },
          when: () =>
            buttonConditionToggles(character.id, index, entry.condition),
        }),
      );

      records.append(
        ...character.records.map((record, index) =>
          buttonRecordBlock(
            character.id,
            record,
            index,
            character.records.length,
          ),
        ),
      );
      fields.push(
        createField('Hit mesh', text(`${character.hitTriangles} triangles`)),
        createSection(`State records (${character.records.length})`),
        records,
        createSection(`Actions (${actions.length})`),
        ...actions,
        addMenu('Add block', addChoices('button'), (id) =>
          id === 'script'
            ? addScript(
                { kind: 'button', id: character.id, condition: 0x8 },
                `#${character.id} on ${formatBitNames(0x8, BUTTON_CONDITIONS)}`,
              )
            : send({
                kind: 'addButtonRecord',
                id: character.id,
                depth,
                character: 1,
                flags: BUTTON_STATES[0][1],
              }),
        ),
      );
      break;
    }
    case 'movie':
      fields.push(...movieBody(character));
      break;
    case 'placeholder':
      fields.push(...importSource(character));
      break;
    default:
      break;
  }
  return fields;
};

/**
 * What a frame script does to timelines, each jump on its own timeline a
 * button to the frame it lands on
 */
const flowOf = (
  frames: Frame[],
  behaviour: Behaviour | undefined,
): HTMLElement | undefined => {
  if (!behaviour?.commands.length) {
    return behaviour?.conditional
      ? text('branches; see the script')
      : undefined;
  }

  const element = document.createElement('span');

  element.className = 'bk-flow';
  element.append(
    ...behaviour.commands.map((command) => {
      const on = command.target.length ? ` on ${command.target.join('.')}` : '';

      if (command.op !== 'goto') {
        return text(`${command.op}()${on}`);
      }

      const name = `${command.play ? 'gotoAndPlay' : 'gotoAndStop'}(${command.label !== undefined ? `"${command.label}"` : command.frame})${on}`;
      const to =
        command.target.length || command.label === undefined
          ? command.frame
          : frames.findIndex((frame) =>
              frame.items.some(
                (item) =>
                  item.type === 'frameLabel' &&
                  item.label.toLowerCase() === command.label!.toLowerCase(),
              ),
            );

      return command.target.length || to === undefined || to < 0
        ? text(name)
        : action(`${name} → ${to}`, () =>
            window.dispatchEvent(new CustomEvent(GO_TO_FRAME, { detail: to })),
          );
    }),
  );
  return element;
};

/** The items of the shown frame of a timeline as blocks, and the menu that adds more */
const frameBlock = (character: Character): HTMLElement => {
  const frames = getFrames(movie(), character);
  const frame = frames[state.frame];
  const timeline = character.id;
  const items = frame?.items ?? [];
  const depths = frames.flatMap((each) =>
    each.items.flatMap((item) =>
      item.type === 'placeObject' || item.type === 'removeObject'
        ? [item.depth]
        : [],
    ),
  );
  const list = reorderList(document.createElement('div'), (from, to) =>
    send({ kind: 'moveItem', timeline, frame: state.frame, from, to }),
  );
  const flow = (block: number) => flowOf(frames, movie().behaviours[block]);

  list.append(
    ...items.map((item, index) =>
      frameItemBlock(item, {
        timeline,
        frame: state.frame,
        index,
        count: items.length,
        flow,
      }),
    ),
  );

  const add = (id: string) => {
    const at = { timeline, frame: state.frame };

    if (id === 'placement') {
      send({
        kind: 'placeObject',
        ...at,
        depth: Math.max(0, ...depths) + 1,
        character:
          movie().characters.find(
            (each) => each.id !== timeline && each.type !== 'movie',
          )?.id ?? 1,
      });
    } else if (id === 'frameLabel') {
      send({ kind: 'addFrameLabel', ...at, label: 'label' });
    } else if (id === 'background') {
      send({ kind: 'addBackgroundColor', ...at, color: 0xff000000 });
    } else {
      addScript({ kind: 'frame', ...at }, `#${timeline} frame ${state.frame}`);
    }
  };

  return blockCard({
    key: `frame:${timeline}:${state.frame}`,
    kind: 'frame',
    title: `Frame ${state.frame}`,
    summary: `${items.length} item${items.length === 1 ? '' : 's'}`,
    open: true,
    body: () => [
      list,
      addMenu('Add block', addChoices('frame'), add),
      action('Add frame', () => send({ kind: 'addFrame', timeline })),
    ],
  });
};

/** Fills the details panel and the frame slider for the selected character */
export const showDetails = (): void => {
  const character = movie().characters[state.selected];
  // An import plays the timeline of what it imports
  const shown = resolve(movie(), state.selected);
  const frames = shown ? getFrames(shown.movie, shown.character) : [];
  const labels = frames.flatMap((frame, index) =>
    frame.items.flatMap((item) =>
      item.type === 'frameLabel' ? [index + ':' + item.label] : [],
    ),
  );
  const editable = !['movie', 'placeholder', 'unknown'].includes(
    character.type,
  );
  const hasTimeline = character.type === 'sprite' || character.type === 'movie';

  frameInput.max = String(Math.max(0, frames.length - 1));
  frameInput.disabled = frames.length < 2;
  frameInput.title = labels.length ? 'labels ' + labels.join(', ') : '';
  state.frame = Math.min(state.frame, Math.max(0, frames.length - 1));

  const stack = document.createElement('div');
  const other = scriptsOutsideFrame(character);

  stack.className = 'bk-stack';
  stack.append(
    blockCard({
      key: `character:${character.id}`,
      kind: kindOfCharacter(character),
      title: describeCharacter(character),
      summary: 'record at 0x' + character.offset.toString(16),
      open: true,
      onDuplicate: editable
        ? () => send({ kind: 'duplicateCharacter', id: character.id })
        : undefined,
      onRemove: editable
        ? () =>
            vscode.postMessage({ kind: 'removeCharacter', id: character.id })
        : undefined,
      body: () => characterBody(character),
    }),
  );
  if (hasTimeline) {
    stack.append(frameBlock(character));
  }
  if (other.length) {
    stack.append(
      blockCard({
        key: `scripts:${character.id}`,
        kind: 'script',
        title: 'Scripts in other frames',
        summary: String(other.length),
        body: () => other.map((site) => scriptBlock(site)),
      }),
    );
  }
  details.replaceChildren(stack);
};

details.addEventListener('keydown', (event) => {
  // Escape from anywhere in a block returns to its header
  if (event.key === 'Escape' && event.target instanceof HTMLElement) {
    event.target
      .closest('.bk')
      ?.querySelector<HTMLElement>('.bk-head')
      ?.focus();
  }
});
