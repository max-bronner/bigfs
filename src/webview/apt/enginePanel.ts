import { pathKey } from './avm/engine';
import type { FunctionEntry, ReadValue, Seen } from './avm/engine';
import { AsObject } from './avm/value';
import type { Value } from './avm/value';
import { button, byId, heading, input, row } from './dom';
import { engine, onEngineChange, saveAnswers } from './engineState';
import { render } from './stage';

/**
 * The engine panel: the game's side of the shown movie, played by hand,
 * from what the movie's own code reached for while it ran.
 *
 * - **Called by the engine**: functions it stores but never names again,
 *   each with a field per parameter and a Call button
 * - **Values**: every variable it read, with what it held; any can be
 *   overridden, and an override wins over the movie's own value from the
 *   next read and is written into the movie, so `_root.side` and `this.side`
 *   read it too. A name not read yet can be added. An override matches the
 *   whole path from the root (`side` is `_root.side`), never a local
 *   variable or a longer path ending in the same name.
 * - **Calls to the engine**: with how often and the last arguments, each
 *   with the value it returns
 *
 * Values are typed as written: `12`, `true`, `"text"`, or bare text.
 */

const panel = byId('engine');
let restart = () => {};
let filter = '';
/** Rows listed per section before the filter has to narrow them */
const MAX_ROWS = 150;

/** What runs the movie again from its start, with the overrides set */
export const onEngineRestart = (run: () => void): void => {
  restart = run;
};

const text = (value: string, className = '') => {
  const element = document.createElement('span');

  element.textContent = value;
  element.className = className;
  return element;
};

/** A short look at a value, without running anything */
const preview = (value: Value): string => {
  if (value instanceof AsObject) {
    return value.kind.type === 'clip'
      ? `clip ${value.kind.instance.name ?? value.kind.instance.path}`
      : value.kind.type === 'array'
        ? 'array'
        : value.kind.type === 'plain'
          ? 'object'
          : 'function';
  }

  const shown =
    typeof value === 'string' ? JSON.stringify(value) : String(value);

  return shown.length > 40 ? `${shown.slice(0, 40)}…` : shown;
};

const changed = (apply: () => void) => {
  apply();
  saveAnswers();
  render();
};

const callRow = (entry: FunctionEntry) => {
  const fields = entry.params.map((param) => {
    const field = input('', () => {}, 'line');

    field.placeholder = param;
    field.classList.add('short');
    return field;
  });

  return row(
    entry.path,
    ...fields,
    button('Call', () => {
      const result = engine.invoke(
        entry,
        fields.map((field) => field.value),
      );

      render();
      panel
        .querySelector('.engine-result')
        ?.replaceChildren(
          result === undefined
            ? ''
            : `${entry.name} returned ${preview(result)}`,
        );
    }),
  );
};

const overrideField = (
  current: string,
  placeholder: string,
  set: (value: string) => void,
) => {
  const field = input(current, (value) => changed(() => set(value)), 'line');

  field.placeholder = placeholder;
  return field;
};

const valueRow = (read: ReadValue) =>
  row(
    read.name,
    overrideField(
      engine.overrides.get(pathKey(read.name)) ?? '',
      preview(read.value),
      (value) => engine.override(read.name, value),
    ),
    text(
      read.found ? `read ${read.count}×` : `read ${read.count}×, never set`,
      'muted',
    ),
  );

const externRow = (seen: Seen) =>
  row(
    seen.name,
    overrideField(
      engine.externOverrides.get(seen.name.toLowerCase()) ?? '',
      engine.externWrites.get(seen.name.toLowerCase())?.value ?? 'not set',
      (value) => engine.overrideExtern(seen.name, value),
    ),
    text(`extern · read ${seen.count}×`, 'muted'),
  );

const callReturnRow = (seen: Seen) => {
  const field = input(
    engine.returns.get(seen.name.toLowerCase()) ?? '',
    (value) =>
      changed(() =>
        value.trim()
          ? engine.returns.set(seen.name.toLowerCase(), value)
          : engine.returns.delete(seen.name.toLowerCase()),
      ),
    'line',
  );

  field.placeholder = 'returns';
  return row(
    seen.name,
    field,
    text(
      `${seen.count}× · last (${(seen.last ?? []).map((arg) => JSON.stringify(arg)).join(', ')})`,
      'muted',
    ),
  );
};

/** The sounds the movie asked for, each to play on request, and the switch that lets it */
const soundRows = () => {
  const toggle = document.createElement('input');

  toggle.type = 'checkbox';
  toggle.checked = engine.playMovieSounds;
  toggle.onchange = () => {
    engine.playMovieSounds = toggle.checked;
  };

  const label = document.createElement('label');

  label.append(toggle, ' Play movie sounds');
  return [
    heading('Sounds the movie asks for'),
    row('', label),
    ...(engine.sounds.size
      ? [...engine.sounds.values()].map((each) =>
          row(
            each.event,
            button('▶ Play', () => engine.playSound(each.event)),
            text(`${each.count}×`, 'muted'),
          ),
        )
      : [text('No PlaySound call yet.', 'muted')]),
  ];
};

/** An override for a name the movie has not read yet */
const addRow = () => {
  const name = input('', () => {}, 'line');
  const value = input('', () => {}, 'line');

  name.placeholder = 'path from _root, or extern.Key';
  value.placeholder = 'value';
  return row(
    'Override',
    name,
    value,
    button('Set', () => {
      if (name.value.trim()) {
        changed(() => engine.override(name.value.trim(), value.value));
      }
    }),
  );
};

const matches = (name: string) =>
  !filter || name.toLowerCase().includes(filter);

const limited = <T>(items: T[], make: (item: T) => HTMLElement) => [
  ...items.slice(0, MAX_ROWS).map(make),
  ...(items.length > MAX_ROWS
    ? [
        text(
          `… and ${items.length - MAX_ROWS} more; narrow them with the filter`,
          'muted',
        ),
      ]
    : []),
];

/** Draws the panel again, unless a field in it is being typed into */
export const showEngine = (): void => {
  const active = document.activeElement;

  // Typing is not interrupted; the panel catches up when the field is left
  if (
    (active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement) &&
    panel.contains(active)
  ) {
    return;
  }

  const functions = [...engine.functions.values()].filter((each) =>
    matches(each.path),
  );
  const entries = functions.filter((each) => each.engineOnly);
  const others = functions.filter((each) => !each.engineOnly);
  const overridden = (name: string) => engine.overrides.has(pathKey(name));
  // Overridden first, then what nothing sets, then the rest, by name
  const reads = [...engine.reads.values()]
    .filter((each) => matches(each.name))
    .sort(
      (a, b) =>
        Number(overridden(b.name)) - Number(overridden(a.name)) ||
        Number(a.found) - Number(b.found) ||
        a.name.localeCompare(b.name),
    );
  const externs = [...engine.externs.values()].filter((each) =>
    matches(each.name),
  );
  const calls = [...engine.calls.values()].filter((each) => matches(each.name));
  const unseen = [...engine.overrides.keys()].filter(
    (key) => !engine.reads.has(key) && matches(key),
  );
  const unseenExterns = [...engine.externOverrides.keys()].filter(
    (key) => !engine.externs.has(key) && matches(key),
  );
  const written = [...engine.externWrites.values()].filter((each) =>
    matches(each.name),
  );
  const more = document.createElement('details');
  const summary = document.createElement('summary');

  summary.textContent = `Other functions the movie defines (${others.length})`;
  more.append(summary, ...limited(others, callRow));

  const search = input(filter, () => {}, 'line');

  search.placeholder = 'filter by name';
  search.oninput = () => {
    filter = search.value.trim().toLowerCase();
  };
  search.onchange = () => {
    search.blur();
    showEngine();
  };

  const wrapper = document.createElement('details');
  const title = document.createElement('summary');

  wrapper.open = panel.querySelector('details')?.open ?? true;
  title.textContent = `Engine: ${engine.overrides.size + engine.externOverrides.size} overrides · ${entries.length} entry points · ${engine.reads.size} values read · ${engine.calls.size} calls`;
  wrapper.append(
    title,
    row('', search),
    heading('Called by the engine'),
    ...(entries.length
      ? limited(entries, callRow)
      : [
          text(
            'No function only the engine calls has been defined yet.',
            'muted',
          ),
        ]),
    ...(others.length ? [more] : []),
    text('', 'engine-result muted'),
    heading('Values'),
    text(
      'An override wins over what the movie holds, from the next read.',
      'muted',
    ),
    addRow(),
    ...unseen.map((key) =>
      row(
        key,
        overrideField(engine.overrides.get(key) ?? '', '', (value) =>
          engine.override(key, value),
        ),
        text('not read yet', 'muted'),
      ),
    ),
    ...unseenExterns.map((key) =>
      row(
        key,
        overrideField(engine.externOverrides.get(key) ?? '', '', (value) =>
          engine.overrideExtern(key, value),
        ),
        text('extern · not read yet', 'muted'),
      ),
    ),
    ...limited(externs, externRow),
    ...limited(written, (each) =>
      row(
        each.name,
        text(each.value),
        text('extern · written by the movie', 'muted'),
      ),
    ),
    ...limited(reads, valueRow),
    ...soundRows(),
    heading('Calls to the engine'),
    ...(calls.length
      ? limited(calls, callReturnRow)
      : [text('No call to the engine yet.', 'muted')]),
    row(
      '',
      button('Restart with these overrides', () => restart()),
      button('Clear overrides', () => changed(() => engine.clear())),
    ),
  );
  panel.replaceChildren(wrapper);
};

onEngineChange(showEngine);
panel.addEventListener('focusout', () => setTimeout(showEngine, 0));
