import { button, byId, heading, row } from './dom';
import { DOWN, OVER, UP, describe } from './player';
import type { Instance } from './player';
import { currentPlayer, inspected, render } from './stage';
import { state } from './state';

/**
 * The inspector: the instance picked on the stage, like an element in a
 * browser's developer tools. It shows where it sits, where its timeline
 * is, and lets its state be set by hand: play, stop, step, go to any of
 * its labels, or hold a button up, over or down.
 */

const panel = byId('inspector');

const TYPE_NAMES: Record<string, string> = {
  sprite: 'Sprite',
  movie: 'Movie',
  button: 'Button',
  shape: 'Shape',
  image: 'Image',
  editText: 'EditText',
  text: 'Text',
};

const act = (change: () => void) => () => {
  change();
  render();
  showInspector();
};

const label = (text: string): HTMLSpanElement => {
  const element = document.createElement('span');

  element.textContent = text;
  return element;
};

/** The way down from the root, each step a link to inspect it */
const breadcrumb = (instance: Instance): HTMLElement => {
  const chain: Instance[] = [];
  const element = document.createElement('div');

  for (let at: Instance | undefined = instance; at; at = at.parent) {
    chain.unshift(at);
  }
  element.className = 'field';
  chain.forEach((step, index) => {
    const link = document.createElement('a');

    link.href = '#';
    link.textContent = index
      ? step.path.slice(step.path.lastIndexOf('/') + 1)
      : 'root';
    link.title = describe(step);
    link.onclick = (event) => {
      event.preventDefault();
      state.inspected = step.path;
      render();
      showInspector();
    };
    element.append(link, ...(index < chain.length - 1 ? [label(' › ')] : []));
  });
  return element;
};

/** Where a timeline is: frame, labels there, and whether it plays */
const frameText = (instance: Instance): string => {
  const here = currentPlayer()
    .labels(instance)
    .filter((each) => each.frame === instance.frame);

  return (
    `${instance.frame} of ${instance.frames.length}` +
    (here.length ? ` "${here.map((each) => each.label).join('", "')}"` : '') +
    (instance.playing ? ' · playing' : ' · stopped')
  );
};

/** Keeps the frame line current as the stage plays, without rebuilding the panel */
export const updateInspector = (): void => {
  const position = document.getElementById('inspector-frame');
  const instance = inspected();

  if (position && instance) {
    position.textContent = frameText(instance);
  }
};

const timelineControls = (instance: Instance): HTMLElement[] => {
  const player = currentPlayer();
  const labels = player.labels(instance);
  const position = label(frameText(instance));

  position.id = 'inspector-frame';

  const rows = [
    row('Frame', position),
    row(
      '',
      button(
        '▶ play',
        act(() => (instance.playing = true)),
      ),
      button(
        '■ stop',
        act(() => (instance.playing = false)),
      ),
      button(
        '‹',
        act(() => player.goTo(instance, instance.frame - 1, false)),
      ),
      button(
        '›',
        act(() => player.goTo(instance, instance.frame + 1, false)),
      ),
    ),
  ];

  if (labels.length) {
    rows.push(
      heading('Labels'),
      ...labels.map((each) =>
        row(
          `${each.frame}`,
          label(each.label),
          button(
            'gotoAndPlay',
            act(() => player.goTo(instance, each.frame, true)),
          ),
          button(
            'gotoAndStop',
            act(() => player.goTo(instance, each.frame, false)),
          ),
        ),
      ),
    );
  }
  return rows;
};

const buttonControls = (instance: Instance): HTMLElement => {
  const player = currentPlayer();
  const states: [string, number | undefined][] = [
    ['Pointer', undefined],
    ['Up', UP],
    ['Over', OVER],
    ['Down', DOWN],
  ];

  return row(
    'State',
    ...states.map(([name, value]) => {
      const choice = button(
        name,
        act(() => player.force(instance, value)),
      );

      if (instance.forced === value) {
        choice.classList.add('chosen');
      }
      choice.title =
        value === undefined
          ? 'Follow the pointer (in interact mode)'
          : `Hold the button ${name.toLowerCase()}`;
      return choice;
    }),
  );
};

/** Fills the inspector for the picked instance, or empties it */
export const showInspector = (): void => {
  const instance = inspected();

  if (!instance) {
    panel.replaceChildren();
    return;
  }

  const { character } = instance;
  const kind = character
    ? (TYPE_NAMES[character.type] ?? character.type)
    : 'Import';
  const parts: HTMLElement[] = [
    heading('Instance'),
    breadcrumb(instance),
    row(
      '',
      label(
        `#${instance.id} ${kind}` +
          (instance.name ? ` "${instance.name}"` : '') +
          (instance.movie !== state.movie
            ? ` from ${instance.movie.name}`
            : '') +
          (instance.missing ? ` · ${instance.missing} not found` : ''),
      ),
      button(
        'Close',
        act(() => (state.inspected = undefined)),
      ),
    ),
  ];

  if (character?.type === 'sprite' || character?.type === 'movie') {
    parts.push(...timelineControls(instance));
  }
  if (character?.type === 'button') {
    parts.push(buttonControls(instance));
  }
  panel.replaceChildren(...parts);
};
