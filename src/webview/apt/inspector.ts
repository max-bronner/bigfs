import { PLACE_FLAGS } from '../../formats/apt/aptMovie';
import type { FrameItem, Matrix2 } from '../../formats/apt/aptMovie';
import type { PlacementChange } from '../../formats/apt/writer/aptEdit';
import { send } from './details';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromPage } from './protocol';

import { CLIP_EVENTS, bitNames, bitSelect } from './scriptSites';
import { byId } from './dom';
import { blockCard } from './blocks/blockCard';
import {
  action,
  characterPicker,
  field,
  numberField,
  placementColour,
  section,
  textField,
} from './blocks/controls';
import { commit, editable } from './edit';
import { DOWN, OVER, UP, describe } from './player';
import type { Instance } from './player';
import { currentPlayer, inspected, render } from './stage';
import { state } from './state';

const vscode = getVsCodeApi<FromPage>();

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
    field('Frame', position),
    field(
      '',
      action(
        '▶ play',
        act(() => (instance.playing = true)),
      ),
      action(
        '■ stop',
        act(() => (instance.playing = false)),
      ),
      action(
        '‹',
        act(() => player.goTo(instance, instance.frame - 1, false)),
      ),
      action(
        '›',
        act(() => player.goTo(instance, instance.frame + 1, false)),
      ),
    ),
  ];

  if (labels.length) {
    rows.push(
      section('Labels'),
      ...labels.map((each) =>
        field(
          `${each.frame}`,
          label(each.label),
          action(
            'gotoAndPlay',
            act(() => player.goTo(instance, each.frame, true)),
          ),
          action(
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

  return field(
    'State',
    ...states.map(([name, value]) => {
      const choice = action(
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
    breadcrumb(instance),
    field(
      '',
      label(
        `#${instance.id} ${kind}` +
          (instance.name ? ` "${instance.name}"` : '') +
          (instance.movie !== state.movie
            ? ` from ${instance.movie.name}`
            : '') +
          (instance.missing ? ` · ${instance.missing} not found` : ''),
      ),
      action(
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
  const cards = [
    blockCard({
      key: `instance:${instance.path}`,
      kind: 'instance',
      title: 'Instance',
      summary: `#${instance.id} ${kind}`,
      open: true,
      body: () => parts,
    }),
  ];

  if (editable(instance)) {
    cards.push(
      blockCard({
        key: `placement:${instance.path}`,
        kind: 'placement',
        title: 'Placement',
        summary: instance.name ? `"${instance.name}"` : `@${depthOf(instance)}`,
        open: true,
        body: () => editControls(instance),
      }),
    );
  } else if (owner && owner !== state.movie) {
    parts.push(field('', label(`Edit it in ${owner.name}`)));
  }
  panel.replaceChildren(...cards);
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

/** Finds a depth no frame of a timeline uses, above every other */
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

type PlaceItem = Extract<FrameItem, { type: 'placeObject' }>;

/**
 * The PlaceObject records an instance takes its state from at its parent's
 * frame: the one that placed it, and the last one that set its colour
 */
const placementRecords = (
  instance: Instance,
): { placed?: PlaceItem; colour?: PlaceItem } => {
  const parent = instance.parent!;
  const depth = depthOf(instance);
  let placed: PlaceItem | undefined;
  let colour: PlaceItem | undefined;

  for (let index = 0; index <= parent.frame; index++) {
    for (const item of parent.frames[index]?.items ?? []) {
      if (item.type === 'removeObject' && item.depth === depth) {
        colour = undefined;
      } else if (item.type === 'placeObject' && item.depth === depth) {
        if (item.offset === instance.placedItem) {
          placed = item;
        }
        if (!(item.flags & PLACE_FLAGS.move)) {
          colour = undefined;
        }
        if (item.colorTransform !== undefined) {
          colour = item;
        }
      }
    }
  }
  return { placed, colour };
};

const checkbox = (
  isChecked: boolean,
  title: string,
  onCommit: (isChecked: boolean) => void,
): HTMLInputElement => {
  const element = document.createElement('input');

  element.type = 'checkbox';
  element.checked = isChecked;
  element.title = title;
  element.onchange = () => onCommit(element.checked);
  return element;
};

/** Fields and actions for an instance whose placement can be written */
const editControls = (instance: Instance): HTMLElement[] => {
  const parent = instance.parent!;
  const timeline = parent.id;
  const depth = depthOf(instance);
  const parts = decompose(instance.matrix);
  const write = (matrix: Matrix2, translate = instance.translate) =>
    commit(instance, [...matrix, ...translate]);
  const numeric = (
    name: string,
    value: number,
    onCommit: (value: number) => void,
  ) => numberField(round(value), onCommit, name, 'short');
  const siblings = [...parent.children.keys()]
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const index = siblings.indexOf(depth);
  const { placed, colour } = placementRecords(instance);
  const writePlaced = (change: PlacementChange) =>
    send({
      kind: 'placement',
      offset: instance.placedItem ?? instance.matrixItem!,
      change,
    });

  const writeColour = (change: PlacementChange) =>
    send({
      kind: 'placement',
      offset: colour?.offset ?? instance.matrixItem!,
      change,
    });
  const events = bitSelect(CLIP_EVENTS, 1 << 9);
  const clipScript =
    instance.character?.type === 'sprite' && instance.placedItem !== undefined
      ? [
          field(
            'Add',
            events,
            action('Clip script', () =>
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
    field(
      'Position',
      numeric('x', instance.translate[0], (x) =>
        write(instance.matrix, [x, instance.translate[1]]),
      ),
      numeric('y', instance.translate[1], (y) =>
        write(instance.matrix, [instance.translate[0], y]),
      ),
    ),
    field(
      'Scale',
      numeric('scale x', parts.scaleX, (value) =>
        write(compose(value, parts.scaleY, parts.rotation, parts.skew)),
      ),
      numeric('scale y', parts.scaleY, (value) =>
        write(compose(parts.scaleX, value, parts.rotation, parts.skew)),
      ),
    ),
    field(
      'Rotation °',
      numeric('degrees', (parts.rotation * 180) / Math.PI, (degrees) =>
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
    field(
      'Character',
      characterPicker(instance.placed, (character) =>
        writePlaced({ character }),
      ),
    ),
    // The colour is written where it comes from at this frame, or where the
    // matrix does when nothing has set one yet
    field(
      'Multiply',
      placementColour(
        'colorTransform',
        colour?.colorTransform ?? 0xffffffff,
        writeColour,
      ),
    ),
    field(
      'Add',
      placementColour('colorAdd', colour?.colorAdd ?? 0, writeColour),
    ),
    field(
      'Ratio',
      numeric('ratio', placed?.ratio ?? 0, (ratio) => writePlaced({ ratio })),
      label('Move'),
      checkbox(
        ((placed?.flags ?? 0) & PLACE_FLAGS.move) !== 0,
        'Modify what is at the depth instead of placing anew',
        (isMove) => writePlaced({ isMove }),
      ),
    ),
    field(
      'Clip depth',
      numeric('clip depth', placed?.clipDepth ?? 0, (clipDepth) =>
        writePlaced({ clipDepth }),
      ),
      checkbox(
        placed?.clipDepth !== undefined,
        'Mask the depths above this one up to the clip depth',
        (isOn) =>
          writePlaced(
            isOn
              ? { clipDepth: placed?.clipDepth ?? depth }
              : { clear: ['clipDepth'] },
          ),
      ),
    ),
    field(
      'Name',
      textField(instance.name ?? '', (name) =>
        send({
          kind: 'placement',
          offset: instance.placedItem ?? instance.matrixItem!,
          change: { name },
        }),
      ),
    ),
    field(
      '',
      action('Duplicate', () => {
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
      action('Remove', () => {
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
        const element = action(name as string, () => {
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
