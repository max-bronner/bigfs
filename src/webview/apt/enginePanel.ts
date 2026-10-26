import type { FunctionEntry, Seen } from './avm/engine';
import { button, byId, heading, input, row } from './dom';
import { engine, onEngineChange, saveAnswers } from './engineState';
import { render } from './stage';

/**
 * The engine panel: the game's side of the shown movie, to play by hand.
 * It lists what the movie's code reached for while it ran, as the engine
 * module found it, and lets each be answered:
 *
 * - functions only the engine calls, each with a field per parameter and
 *   a Call button, and the rest of the movie's functions folded away
 * - values it reads that it never sets, and `GetExtern`/`extern.` keys,
 *   each with a value field
 * - calls it makes into the engine, with how often and the last
 *   arguments, each with the value the call returns
 *
 * Values are typed as written: `12`, `true`, `"text"`, or bare text.
 * They hold from the next read; Restart runs the movie again with them.
 */

const panel = byId('engine');
let restart = () => {};

/** What runs the movie again from its start, with the answers given */
export const onEngineRestart = (run: () => void): void => {
  restart = run;
};

const text = (value: string, className = '') => {
  const element = document.createElement('span');

  element.textContent = value;
  element.className = className;
  return element;
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
      if (result !== undefined) {
        panel
          .querySelector('.engine-result')
          ?.replaceChildren(`${entry.name} returned ${JSON.stringify(result)}`);
      }
    }),
  );
};

const answerRow = (
  seen: Seen,
  answers: Map<string, string>,
  note: string,
  placeholder: string,
) => {
  const field = input(
    answers.get(seen.name.toLowerCase()) ?? '',
    (value) => {
      if (value.trim()) {
        answers.set(seen.name.toLowerCase(), value);
      } else {
        answers.delete(seen.name.toLowerCase());
      }
      saveAnswers();
    },
    'line',
  );

  field.placeholder = placeholder;
  return row(seen.name, field, text(note, 'muted'));
};

const section = (title: string, rows: HTMLElement[], empty: string) => [
  heading(title),
  ...(rows.length ? rows : [text(empty, 'muted')]),
];

/** Draws the panel again, unless a field in it is being typed into */
export const showEngine = (): void => {
  if (
    panel.contains(document.activeElement) &&
    document.activeElement !== document.body
  ) {
    return;
  }

  const functions = [...engine.functions.values()];
  const entries = functions.filter((each) => each.engineOnly);
  const others = functions.filter((each) => !each.engineOnly);
  const read = [...engine.read.values()];
  const externs = [...engine.externs.values()];
  const calls = [...engine.calls.values()];
  const more = document.createElement('details');
  const summary = document.createElement('summary');

  summary.textContent = `Other functions the movie defines (${others.length})`;
  more.append(summary, ...others.map(callRow));

  const wrapper = document.createElement('details');
  const title = document.createElement('summary');

  wrapper.open = panel.querySelector('details')?.hasAttribute('open') ?? true;
  title.textContent = `Engine: ${entries.length} entry points · ${read.length + externs.length} values · ${calls.length} calls`;
  wrapper.append(
    title,
    ...section(
      'Called by the engine',
      entries.map(callRow),
      'No function only the engine calls has been defined yet.',
    ),
    ...(others.length ? [more] : []),
    text('', 'engine-result muted'),
    ...section(
      'Values the engine provides',
      [
        ...externs.map((seen) =>
          answerRow(
            seen,
            engine.values,
            `extern · read ${seen.count}×`,
            'not set',
          ),
        ),
        ...read.map((seen) =>
          answerRow(
            seen,
            engine.values,
            `read ${seen.count}×, never set`,
            'not set',
          ),
        ),
      ],
      'Nothing read yet that the movie does not set itself.',
    ),
    ...section(
      'Calls to the engine',
      calls.map((seen) =>
        answerRow(
          seen,
          engine.returns,
          `${seen.count}× · last (${(seen.last ?? []).map((arg) => JSON.stringify(arg)).join(', ')})`,
          'returns',
        ),
      ),
      'No call to the engine yet.',
    ),
    row(
      '',
      button('Restart with these values', () => restart()),
      button('Clear values', () => {
        engine.values.clear();
        engine.returns.clear();
        saveAnswers();
        restart();
      }),
    ),
  );
  panel.replaceChildren(wrapper);
};

onEngineChange(showEngine);
