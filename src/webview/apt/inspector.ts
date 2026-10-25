import type { Matrix2 } from '../../formats/apt/aptMovie';
import { send, vscode } from './details';
import { CLIP_EVENTS, bitNames, bitSelect } from './scriptSites';
import { button, byId, heading, input, row } from './dom';
import { commit, editable } from './edit';
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
  const owner = instance.parent?.movie;

  if (editable(instance)) {
    parts.push(...editControls(instance));
  } else if (owner && owner !== state.movie) {
    parts.push(row('', label(`Edit it in ${owner.name}`)));
  }
  panel.replaceChildren(...parts);
};

/** Position, scale, rotation and skew of a placement, the way an editor shows them */
const decompose = ([a, b, c, d]: Matrix2) => {
  const scaleX = Math.hypot(a, b);
  const rotation = Math.atan2(b, a);
  const scaleY = scaleX ? (a * d - b * c) / scaleX : Math.hypot(c, d);
  // What is left once scale and rotation are taken out
  const skew = scaleX ? (a * c + b * d) / (scaleX * scaleX) : 0;

  return { scaleX, scaleY, rotation, skew };
};

const compose = (
  scaleX: number,
  scaleY: number,
  rotation: number,
  skew: number,
): Matrix2 => {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return [
    scaleX * cos,
    scaleX * sin,
    scaleX * skew * cos - scaleY * sin,
    scaleX * skew * sin + scaleY * cos,
  ];
};

const round = (value: number, places = 3) =>
  Math.round(value * 10 ** places) / 10 ** places;

/** The depth an instance sits at, from the last step of its path */
const depthOf = (instance: Instance) =>
  Number(instance.path.slice(instance.path.lastIndexOf('/') + 1));

/** A depth no frame of a timeline uses, above every other */
export const freeDepth = (timeline: Instance): number =>
  Math.max(
    0,
    ...timeline.frames.flatMap((frame) =>
      frame.items.flatMap((item) =>
        item.type === 'placeObject' || item.type === 'removeObject'
          ? [item.depth]
          : [],
      ),
    ),
  ) + 1;

/** Fields and actions for an instance whose placement can be written */
const editControls = (instance: Instance): HTMLElement[] => {
  const parent = instance.parent!;
  const timeline = parent.id;
  const depth = depthOf(instance);
  const parts = decompose(instance.matrix);
  const write = (matrix: Matrix2, translate = instance.translate) =>
    commit(instance, [...matrix, ...translate]);
  const field = (
    name: string,
    value: number,
    onCommit: (value: number) => void,
  ) => {
    const element = input(round(value), onCommit);

    element.classList.add('short');
    element.title = name;
    return element;
  };
  const siblings = [...parent.children.keys()]
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const index = siblings.indexOf(depth);
  const alpha = Math.round(instance.alpha * 255);

  const events = bitSelect(CLIP_EVENTS, 1 << 9);
  const clipScript =
    instance.character?.type === 'sprite' && instance.placedItem !== undefined
      ? [
          row(
            'Add',
            events,
            button('Clip script', () =>
              vscode.postMessage({
                kind: 'addScript',
                label: `${parent.movie.name} @${depth} on ${bitNames(Number(events.value), CLIP_EVENTS)}`,
                to: {
                  kind: 'clip',
                  offset: instance.placedItem!,
                  events: Number(events.value),
                },
              }),
            ),
          ),
        ]
      : [];

  return [
    ...clipScript,
    heading('Placement'),
    row(
      'Position',
      field('x', instance.translate[0], (x) =>
        write(instance.matrix, [x, instance.translate[1]]),
      ),
      field('y', instance.translate[1], (y) =>
        write(instance.matrix, [instance.translate[0], y]),
      ),
    ),
    row(
      'Scale',
      field('scale x', parts.scaleX, (value) =>
        write(compose(value, parts.scaleY, parts.rotation, parts.skew)),
      ),
      field('scale y', parts.scaleY, (value) =>
        write(compose(parts.scaleX, value, parts.rotation, parts.skew)),
      ),
    ),
    row(
      'Rotation °',
      field('degrees', (parts.rotation * 180) / Math.PI, (degrees) =>
        write(
          compose(
            parts.scaleX,
            parts.scaleY,
            (degrees * Math.PI) / 180,
            parts.skew,
          ),
        ),
      ),
      ...(Math.abs(parts.skew) > 1e-6
        ? [label(`skew ${round(parts.skew)}`)]
        : []),
    ),
    row(
      'Alpha',
      field('0 to 255', alpha, (value) =>
        send({
          kind: 'placement',
          offset: instance.matrixItem!,
          change: {
            colorTransform:
              (0xffffff | (Math.max(0, Math.min(255, value)) << 24)) >>> 0,
          },
        }),
      ),
    ),
    row(
      'Name',
      input(
        instance.name ?? '',
        (name) =>
          send({
            kind: 'placement',
            offset: instance.placedItem ?? instance.matrixItem!,
            change: { name },
          }),
        'line',
      ),
    ),
    row(
      '',
      button('Duplicate', () => {
        const next = freeDepth(parent);

        state.inspected = `${parent.path}/${next}`;
        send({
          kind: 'placeObject',
          timeline,
          frame: parent.frame,
          depth: next,
          character: instance.placed,
          matrix: instance.matrix,
          translate: [instance.translate[0] + 10, instance.translate[1] + 10],
        });
      }),
      button('Remove', () => {
        state.inspected = undefined;
        // Placed in this frame: drop the record; placed earlier: remove it from here on
        send(
          instance.born === parent.frame && instance.placedItem !== undefined
            ? {
                kind: 'removeItem',
                timeline,
                frame: parent.frame,
                offset: instance.placedItem,
              }
            : { kind: 'removeObject', timeline, frame: parent.frame, depth },
        );
      }),
      ...[
        ['Forward', siblings[index + 1]],
        ['Backward', siblings[index - 1]],
      ].map(([name, other]) => {
        const element = button(name as string, () => {
          state.inspected = `${parent.path}/${other}`;
          send({ kind: 'swapDepths', timeline, a: depth, b: other as number });
        });

        element.disabled = other === undefined;
        element.title = `Swap depth ${depth} with ${other ?? 'nothing'}`;
        return element;
      }),
    ),
  ];
};
