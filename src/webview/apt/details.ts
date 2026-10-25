import type { Character, Matrix2 } from '../../formats/apt/aptMovie';
import type { AptEdit } from '../../formats/apt/aptWriter';
import { button, byId, heading, input, row } from './dom';
import type { FromPage, ToPage } from './protocol';
import { movie, state } from './state';
import { framesOf } from './timeline';

declare const acquireVsCodeApi: () => { postMessage(message: FromPage): void };

export const vscode = acquireVsCodeApi();

const details = byId('details');
const frameInput = byId<HTMLInputElement>('frame');
const frameLabel = byId('frame-label');

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
      ? imported.movie + ':' + imported.name
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
const blocksOf = (character: Character) => {
  const blocks: { label: string; block: number }[] = [];

  framesOf(movie(), character).forEach((frame, index) => {
    for (const item of frame.items) {
      if (item.type === 'action') {
        blocks.push({ label: 'frame ' + index, block: item.block });
      }
      if (item.type === 'initAction') {
        blocks.push({ label: 'init #' + item.sprite, block: item.block });
      }
      if (item.type === 'placeObject') {
        for (const clip of item.clipActions ?? []) {
          blocks.push({
            label: `frame ${index} clip events 0x${clip.events.toString(16)} @${item.depth}`,
            block: clip.block,
          });
        }
      }
    }
  });
  if (character.type === 'button') {
    character.actions.forEach((action) =>
      blocks.push({
        label: 'button 0x' + action.condition.toString(16),
        block: action.block,
      }),
    );
  }
  return blocks;
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
        ...(['editText', 'sprite', 'shape', 'image'] as const).map((type) =>
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
  if (!['movie', 'placeholder', 'unknown'].includes(character.type)) {
    fields.push(
      row(
        '',
        button('Duplicate', () =>
          send({ kind: 'duplicateCharacter', id: character.id }),
        ),
      ),
    );
  }
  return fields;
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
  const frames = framesOf(movie(), character);
  const labels = frames.flatMap((frame, index) =>
    frame.items.flatMap((item) =>
      item.type === 'frameLabel' ? [index + ':' + item.label] : [],
    ),
  );
  const offset = document.createElement('p');
  const blocks = blocksOf(character);

  frameInput.max = String(Math.max(0, frames.length - 1));
  frameInput.disabled = frames.length < 2;
  state.frame = Math.min(state.frame, Math.max(0, frames.length - 1));
  frameInput.value = String(state.frame);
  frameLabel.textContent = frames.length
    ? 'frame ' +
      state.frame +
      ' of ' +
      frames.length +
      (labels.length ? ' · labels ' + labels.join(', ') : '')
    : '';

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
  if (blocks.length) {
    details.append(heading('Scripts'));
    for (const each of blocks) {
      const element = document.createElement('details');
      const summary = document.createElement('summary');
      const body = document.createElement('div');

      element.dataset.block = String(each.block);
      summary.textContent = each.label + ' · 0x' + each.block.toString(16);
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
