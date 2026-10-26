import type { Character, Frame, Matrix2 } from '../../formats/apt/aptMovie';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { AptEdit } from '../../formats/apt/aptWriter';
import { button, byId, heading, input, row } from './dom';
import type { FromPage, ToPage } from './protocol';
import {
  BUTTON_CONDITIONS,
  CLIP_EVENTS,
  bitNames,
  bitSelect,
} from './scriptSites';
import { movie, state } from './state';
import { movieNamed, resolve } from './resolve';
import { framesOf } from './timeline';

declare const acquireVsCodeApi: () => { postMessage(message: FromPage): void };

export const vscode = acquireVsCodeApi();

const details = byId('details');
const frameInput = byId<HTMLInputElement>('frame');

const TYPE_NAMES: Record<Character['type'], string> = {
  movie: 'Movie',
  shape: 'Shape',
  editText: 'EditText',
  font: 'Font',
  button: 'Button',
  sprite: 'Sprite',
  image: 'Image',
  morph: 'Morph',
  text: 'Text',
  placeholder: 'Import',
  unknown: 'Unknown',
};

/** A character's label in the list: its id, type and any export or import name */
export const describe = (character: Character): string => {
  const source = movie();
  const exported = source.exports
    .filter((each) => each.character === character.id)
    .map((each) => each.name);
  const imported = source.imports.find(
    (each) => each.character === character.id,
  );
  const extra = exported.length
    ? exported.join(', ')
    : imported
      ? imported.movie +
        ':' +
        imported.name +
        (resolve(source, character.id) ? '' : ' (unresolved)')
      : character.type === 'editText'
        ? (character.variable ?? character.text ?? '')
        : '';

  return (
    '#' +
    character.id +
    ' ' +
    TYPE_NAMES[character.type] +
    (extra ? ' · ' + extra : '')
  );
};

/** Sends an edit; the extension applies it and sends the movie back */
export const send = (edit: AptEdit): void =>
  vscode.postMessage({ kind: 'edit', edit });

/** Inputs for a 2x2 matrix and a translation, raw so a skew survives */
const matrixInputs = (
  matrix: Matrix2 | undefined,
  translate: [number, number] | undefined,
  onCommit: (matrix: Matrix2, translate: [number, number]) => void,
) => {
  const values = [...(matrix ?? [1, 0, 0, 1]), ...(translate ?? [0, 0])];

  return ['a', 'b', 'c', 'd', 'x', 'y'].map((name, index) => {
    const element = input(values[index], (value) => {
      values[index] = value;
      onCommit(
        values.slice(0, 4) as Matrix2,
        values.slice(4) as [number, number],
      );
    });

    element.title = name;
    element.classList.add('short');
    return element;
  });
};

/** The action blocks a character or its timeline runs, for the details panel */
/** A script of a character or its timeline: where it runs, and how it is detached */
interface ScriptEntry {
  label: string;
  block: number;
  /** The edit that detaches it; absent when it cannot be detached here */
  remove?: AptEdit;
}

const blocksOf = (character: Character): ScriptEntry[] => {
  const blocks: ScriptEntry[] = [];
  const timeline = character.id;

  framesOf(movie(), character).forEach((frame, index) => {
    for (const item of frame.items) {
      if (item.type === 'action' || item.type === 'initAction') {
        blocks.push({
          label:
            item.type === 'action'
              ? `frame ${index}`
              : `frame ${index} init #${item.sprite}`,
          block: item.block,
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
          blocks.push({
            label: `frame ${index} @${item.depth} on ${bitNames(clip.events, CLIP_EVENTS)}`,
            block: clip.block,
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
  if (character.type === 'button') {
    character.actions.forEach((action, index) =>
      blocks.push({
        label: `on ${bitNames(action.condition, BUTTON_CONDITIONS)}`,
        block: action.block,
        remove: { kind: 'removeButtonAction', id: character.id, index },
      }),
    );
  }
  return blocks;
};

/** Ways to attach a new script to the selected character */
const addScriptFields = (character: Character): HTMLElement[] => {
  const name = `#${character.id}`;
  const add = (
    to: Extract<FromPage, { kind: 'addScript' }>['to'],
    label: string,
  ) =>
    vscode.postMessage({
      kind: 'addScript',
      to,
      label: `${movie().name} ${label}`,
    });

  if (character.type === 'sprite' || character.type === 'movie') {
    return [
      row(
        'Add',
        button(`Frame ${state.frame} script`, () =>
          add(
            { kind: 'frame', timeline: character.id, frame: state.frame },
            `${name} frame ${state.frame}`,
          ),
        ),
      ),
    ];
  }
  if (character.type === 'button') {
    const condition = bitSelect(BUTTON_CONDITIONS, 0x1);

    return [
      row(
        'Add',
        condition,
        button('Button script', () =>
          add(
            {
              kind: 'button',
              id: character.id,
              condition: Number(condition.value),
            },
            `${name} on ${bitNames(Number(condition.value), BUTTON_CONDITIONS)}`,
          ),
        ),
      ),
    ];
  }
  return [];
};

/** The fields of the selected character that can be edited, by type */
const characterFields = (character: Character): HTMLElement[] => {
  const source = movie();
  const fields: HTMLElement[] = [];
  const change =
    (field: string) =>
    (value: unknown): void =>
      send({
        kind: 'character',
        id: character.id,
        change: { field, value },
      } as AptEdit);

  if ('bounds' in character) {
    const bounds = [...character.bounds];

    fields.push(
      row(
        'Bounds',
        ...bounds.map((value, index) => {
          const element = input(value, (next) => {
            bounds[index] = next;
            change('bounds')(bounds);
          });

          element.classList.add('short');
          return element;
        }),
      ),
    );
  }
  if (character.type === 'editText') {
    fields.push(
      row(
        'Text',
        input(
          character.text ?? '',
          (value) => change('line')(value === '' ? undefined : value),
          'line',
        ),
      ),
      row(
        'Variable',
        input(
          character.variable ?? '',
          (value) =>
            change('variable')(value.trim() === '' ? undefined : value.trim()),
          'line',
        ),
      ),
      row('Colour ARGB', input(character.color, change('color'), 'hex')),
      row('Font height', input(character.fontHeight, change('fontHeight'))),
      row('Font #', input(character.font, change('font'))),
      row('Alignment', input(character.alignment, change('alignment'))),
      ...(['readonly', 'multiline', 'wordwrap'] as const).map((flag) =>
        row(flag, input(character[flag], change(flag))),
      ),
    );
  }
  if (character.type === 'font') {
    fields.push(
      row(
        'Font name',
        input(
          character.name ?? '',
          (value) => change('fontName')(value || undefined),
          'line',
        ),
      ),
    );
  }
  if (character.type === 'image') {
    fields.push(row('Texture id', input(character.texture, change('texture'))));
  }
  if (character.type === 'shape') {
    fields.push(
      row(
        'Geometry',
        input(character.geometry, change('geometry')),
        button('Open .ru', () =>
          vscode.postMessage({
            kind: 'openGeometry',
            geometry: character.geometry,
          }),
        ),
      ),
    );
  }
  if (character.type === 'button') {
    character.records.forEach((record, index) => {
      const flags = input(record.flags, (value) =>
        send({ kind: 'buttonRecord', offset: record.offset, flags: value }),
      );

      flags.title = 'bit 0 up, 1 over, 2 down, 3 hit test';
      fields.push(
        row(
          'Record ' + index,
          button('×', () =>
            send({ kind: 'removeButtonRecord', id: character.id, index }),
          ),
          flags,
          input(record.character, (value) =>
            send({
              kind: 'buttonRecord',
              offset: record.offset,
              character: value,
            }),
          ),
          ...matrixInputs(
            record.matrix,
            record.translate,
            (matrix, translate) =>
              send({
                kind: 'buttonRecord',
                offset: record.offset,
                matrix,
                translate,
              }),
          ),
        ),
      );
    });
    const added = { character: 1, flags: 15 };
    const depth =
      Math.max(0, ...character.records.map((record) => record.depth)) + 1;

    fields.push(
      row(
        'New record',
        input(1, (value) => (added.character = value)),
        input(15, (value) => (added.flags = value)),
        button('Add record', () =>
          send({ kind: 'addButtonRecord', id: character.id, depth, ...added }),
        ),
      ),
    );
  }

  if (character.type === 'movie') {
    const size = [character.record.screenWidth, character.record.screenHeight];
    const added = { name: '', character: 1 };
    const imported = { movie: '', name: '' };

    fields.push(
      row(
        'Screen',
        ...size.map((value, index) =>
          input(value, (next) => {
            size[index] = next;
            send({ kind: 'screen', width: size[0], height: size[1] });
          }),
        ),
      ),
      row(
        'Movie',
        button('Rename movie…', () =>
          vscode.postMessage({ kind: 'manageMovie', action: 'rename' }),
        ),
        button('Delete movie…', () =>
          vscode.postMessage({ kind: 'manageMovie', action: 'delete' }),
        ),
      ),
      heading('Exports'),
      ...source.exports.map((entry, index) =>
        row(
          '',
          input(
            entry.name,
            (name) => send({ kind: 'export', index, name }),
            'line',
          ),
          input(entry.character, (value) =>
            send({ kind: 'export', index, character: value }),
          ),
          button('Remove', () => send({ kind: 'removeExport', index })),
        ),
      ),
      row(
        'New',
        input('', (name) => (added.name = name), 'line'),
        input(1, (value) => (added.character = value)),
        button(
          'Add export',
          () => added.name && send({ kind: 'addExport', ...added }),
        ),
      ),
      heading('Imports'),
      ...source.imports.map((entry, index) =>
        row(
          '#' + entry.character,
          input(
            entry.movie,
            (value) => send({ kind: 'import', index, movie: value }),
            'line',
          ),
          input(
            entry.name,
            (name) => send({ kind: 'import', index, name }),
            'line',
          ),
          button('Remove', () => send({ kind: 'removeImport', index })),
        ),
      ),
      row(
        'New',
        input('', (value) => (imported.movie = value), 'line'),
        input('', (name) => (imported.name = name), 'line'),
        button(
          'Add import',
          () =>
            imported.movie &&
            imported.name &&
            send({ kind: 'addImport', ...imported }),
        ),
      ),
      heading('New character'),
      row(
        '',
        ...(['editText', 'sprite', 'shape', 'image', 'button'] as const).map(
          (type) =>
            button(
              type === 'editText'
                ? 'Text'
                : type[0].toUpperCase() + type.slice(1),
              () => send({ kind: 'addCharacter', type }),
            ),
        ),
      ),
    );
  }
  if (character.type === 'placeholder') {
    fields.push(...importFields(character));
  }
  if (!['movie', 'placeholder', 'unknown'].includes(character.type)) {
    fields.push(
      row(
        '',
        button('Duplicate', () =>
          send({ kind: 'duplicateCharacter', id: character.id }),
        ),
        button('Remove', () =>
          vscode.postMessage({ kind: 'removeCharacter', id: character.id }),
        ),
      ),
    );
  }
  return fields;
};

/** Where an import comes from, and what it resolves to there */
const importFields = (character: Character): HTMLElement[] => {
  const entry = movie().imports.find((each) => each.character === character.id);

  if (!entry) {
    return [row('Import', text('no import fills this slot'))];
  }

  const target = movieNamed(entry.movie);
  const resolved = resolve(movie(), character.id);
  const exported = target?.exports.find(
    (each) => each.name.toLowerCase() === entry.name.toLowerCase(),
  );

  return [
    row(
      'From',
      text(
        target
          ? `${target.name}${target.origin ? ' · ' + target.origin : ''}`
          : `${entry.movie}: no install holds this movie`,
      ),
      ...(target
        ? [
            button('Open', () =>
              vscode.postMessage({ kind: 'openMovie', name: entry.movie }),
            ),
          ]
        : []),
    ),
    row(
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

const text = (value: string): HTMLSpanElement => {
  const element = document.createElement('span');

  element.textContent = value;
  return element;
};

/** Asks the page to show a frame of the timeline on the stage */
export const GO_TO_FRAME = 'apt-go-to-frame';

/**
 * What a frame script does to timelines, each jump on its own timeline a
 * button to the frame it lands on
 */
const flowOf = (frames: Frame[], behaviour: Behaviour | undefined) => {
  if (!behaviour?.commands.length) {
    return [
      text(
        behaviour?.conditional
          ? 'branches; see the script'
          : 'no timeline commands',
      ),
    ];
  }
  return behaviour.commands.map((command) => {
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
      : button(`${name} → ${to}`, () =>
          window.dispatchEvent(new CustomEvent(GO_TO_FRAME, { detail: to })),
        );
  });
};

/** The items of the shown frame of a timeline, each editable, and ways to add more */
const frameFields = (character: Character): HTMLElement[] => {
  const frames = framesOf(movie(), character);
  const fields: HTMLElement[] = [heading('Frame ' + state.frame)];
  const frame = frames[state.frame];
  const timeline = character.id;
  const place = { character: 1, depth: 1 };
  let label = '';

  for (const item of frame ? frame.items : []) {
    const remove = button('×', () =>
      send({
        kind: 'removeItem',
        timeline,
        frame: state.frame,
        offset: item.offset,
      }),
    );

    remove.title = 'Remove this item from the frame';
    if (item.type === 'placeObject') {
      const placement = (change: Record<string, unknown>) =>
        send({ kind: 'placement', offset: item.offset, change } as AptEdit);
      const alpha = input(
        item.colorTransform === undefined ? 255 : item.colorTransform >>> 24,
        (value) =>
          placement({
            colorTransform:
              (((item.colorTransform ?? 0xffffffff) & 0xffffff) |
                (Math.max(0, Math.min(255, value)) << 24)) >>>
              0,
          }),
      );

      alpha.title = 'alpha 0-255';
      alpha.classList.add('short');
      fields.push(
        row(
          'Place @' + item.depth,
          input(item.character ?? '', (value) =>
            placement({ character: value }),
          ),
          ...matrixInputs(item.matrix, item.translate, (matrix, translate) =>
            placement({ matrix, translate }),
          ),
          alpha,
          input(item.name ?? '', (name) => placement({ name }), 'line'),
          remove,
        ),
      );
    } else if (item.type === 'frameLabel') {
      fields.push(
        row(
          'Label',
          input(
            item.label,
            (value) =>
              send({ kind: 'frameLabel', offset: item.offset, label: value }),
            'line',
          ),
          remove,
        ),
      );
    } else if (item.type === 'action') {
      fields.push(
        row(
          'Script',
          ...flowOf(frames, movie().behaviours[item.block]),
          remove,
        ),
      );
    } else if (item.type === 'removeObject') {
      fields.push(row('Remove @' + item.depth, remove));
    } else {
      fields.push(row(item.type, remove));
    }
  }
  fields.push(
    row(
      'Place',
      input(1, (value) => (place.character = value)),
      input(1, (value) => (place.depth = value)),
      button('Add', () =>
        send({ kind: 'placeObject', timeline, frame: state.frame, ...place }),
      ),
    ),
    row(
      'Label',
      input('', (value) => (label = value), 'line'),
      button(
        'Add',
        () =>
          label &&
          send({ kind: 'addFrameLabel', timeline, frame: state.frame, label }),
      ),
    ),
    row(
      '',
      button('Add frame', () => send({ kind: 'addFrame', timeline })),
    ),
  );
  return fields;
};

/** Fills the details panel and the frame slider for the selected character */
export const showDetails = (): void => {
  const character = movie().characters[state.selected];
  // An import plays the timeline of what it imports
  const shown = resolve(movie(), state.selected);
  const frames = shown ? framesOf(shown.movie, shown.character) : [];
  const labels = frames.flatMap((frame, index) =>
    frame.items.flatMap((item) =>
      item.type === 'frameLabel' ? [index + ':' + item.label] : [],
    ),
  );
  const offset = document.createElement('p');
  const blocks = blocksOf(character);

  frameInput.max = String(Math.max(0, frames.length - 1));
  frameInput.disabled = frames.length < 2;
  frameInput.title = labels.length ? 'labels ' + labels.join(', ') : '';
  state.frame = Math.min(state.frame, Math.max(0, frames.length - 1));

  offset.className = 'muted';
  offset.textContent = 'record at 0x' + character.offset.toString(16);
  details.replaceChildren(
    heading(describe(character)),
    offset,
    ...characterFields(character),
  );
  if (character.type === 'sprite' || character.type === 'movie') {
    details.append(...frameFields(character));
  }
  const adding = addScriptFields(character);

  if (blocks.length || adding.length) {
    details.append(heading('Scripts'), ...adding);
  }
  for (const each of blocks) {
    const element = document.createElement('details');
    const summary = document.createElement('summary');
    const body = document.createElement('div');
    const label = `${movie().name} #${character.id} ${each.label}`;
    const edit = button('Edit in tab', () =>
      vscode.postMessage({ kind: 'openScript', block: each.block, label }),
    );

    element.dataset.block = String(each.block);
    summary.textContent = each.label + ' · 0x' + each.block.toString(16) + ' ';
    summary.append(edit);
    if (each.remove) {
      const remove = each.remove;

      summary.append(button('Remove', () => send(remove)));
    }
    // A button in the summary acts; it does not fold the panel
    summary
      .querySelectorAll('button')
      .forEach((element) =>
        element.addEventListener('click', (event) => event.preventDefault()),
      );
    body.className = 'script';
    body.textContent = '…';
    element.append(summary, body);
    element.addEventListener('toggle', () => {
      if (element.open) {
        state.openBlocks.add(each.block);
        vscode.postMessage({ kind: 'script', block: each.block });
      } else {
        state.openBlocks.delete(each.block);
      }
    });
    details.append(element);
    if (state.openBlocks.has(each.block)) {
      element.open = true;
    }
  }
};

/** Fills a script panel: editable text, or a read-only listing */
export const showScript = (data: Extract<ToPage, { kind: 'script' }>): void => {
  const body = details.querySelector(
    `details[data-block="${data.block}"] .script`,
  );

  if (!body) {
    return;
  }

  const editable = data.mode !== 'listing';
  const text = document.createElement('textarea');
  const bar = document.createElement('div');
  const mode = document.createElement('span');

  text.className = 'code';
  text.spellcheck = false;
  text.readOnly = !editable;
  text.value = state.drafts.get(data.block) ?? data.text;
  text.rows = Math.min(30, Math.max(4, text.value.split('\n').length + 1));
  text.addEventListener('input', () =>
    state.drafts.set(data.block, text.value),
  );
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      text.setRangeText('  ', text.selectionStart, text.selectionEnd, 'end');
      state.drafts.set(data.block, text.value);
    }
  });

  bar.className = 'field';
  mode.className = 'muted';
  mode.textContent =
    data.mode === 'script'
      ? 'script'
      : data.mode === 'assembly'
        ? 'assembly (one instruction a line)'
        : 'listing, read-only';
  if (data.note) {
    mode.title = data.note;
  }
  bar.append(mode);
  if (editable) {
    bar.append(
      button('Apply', () =>
        vscode.postMessage({
          kind: 'scriptEdit',
          block: data.block,
          text: text.value,
        }),
      ),
      button('Reset', () => {
        state.drafts.delete(data.block);
        text.value = data.text;
      }),
    );
  }
  body.replaceChildren(text, bar);
};
