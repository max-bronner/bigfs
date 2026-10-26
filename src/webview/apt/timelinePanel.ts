import { EASINGS, compileExpression } from '../../common/expression';
import {
  decodeTimeline,
  detectTweens,
  poseOf,
} from '../../formats/apt/aptTimeline';
import type {
  DetectedTween,
  Pose,
  TimelineOperation,
} from '../../formats/apt/aptTimeline';
import {
  MotionScriptError,
  parseMotionScript,
  tweensAsScript,
} from '../../formats/apt/motionScript';
import { send, showDetails } from './details';
import { button, byId } from './dom';
import { currentPlayer, goToFrame, render, showMode, view } from './stage';
import { state } from './state';
import { displayList } from './timeline';

/**
 * The timeline panel: depths by frames, the way an animation editor shows
 * a timeline, with what each frame does at each depth. A range of frames,
 * at one depth or all, is what the tools work on, so a motion, a fade or
 * a hidden stretch is set once for the range rather than frame by frame:
 * a tween to an end pose with an easing, a formula per property, hiding
 * and showing, and inserting, deleting, duplicating, reversing and
 * retiming frames. APT keeps every frame baked, so each tool writes the
 * per-frame records for the whole range.
 */

const panel = byId('timeline');

/** The range the tools act on: frames `from`..`to`, at `depth` or every depth */
const selection: { from: number; to: number; anchor: number; depth?: number } =
  { from: 0, to: 0, anchor: 0 };
let form: 'tween' | 'formula' | 'script' | undefined;
/** The motion script being written, kept while the panel redraws */
let scriptText: string | undefined;
/** The easing a tween form starts on: a detected tween's own */
let formEasing = 'linear';

const POSE_KEYS: (keyof Pose)[] = [
  'x',
  'y',
  'scaleX',
  'scaleY',
  'rotation',
  'skew',
  'alpha',
];

/** The timeline shown on the stage, when it is this movie's and has frames to edit */
const shownTimeline = () => {
  const root = currentPlayer().root;

  return root.movie === state.movie &&
    (root.character?.type === 'sprite' || root.character?.type === 'movie')
    ? root
    : undefined;
};

const run = (operation: TimelineOperation) => {
  const timeline = shownTimeline();

  if (timeline) {
    form = undefined;
    send({ kind: 'timeline', timeline: timeline.id, operation });
  }
};

/** What a depth does in each frame: placed anew, changed, held, removed or empty */
const cellsOf = (frames: ReturnType<typeof shownTimeline> & object) => {
  const depths = new Set<number>();
  const present = new Set<number>();
  const cells = frames.frames.map((frame) => {
    const marks = new Map<number, string>();

    for (const item of frame.items) {
      if (item.type === 'removeObject') {
        present.delete(item.depth);
        marks.set(item.depth, 'removed');
      } else if (item.type === 'placeObject') {
        depths.add(item.depth);
        marks.set(
          item.depth,
          !(item.flags & 1) || !present.has(item.depth) ? 'born' : 'key',
        );
        present.add(item.depth);
      }
    }
    for (const depth of present) {
      if (!marks.has(depth)) {
        marks.set(depth, 'held');
      }
    }
    return marks;
  });

  return { depths: [...depths].sort((a, b) => a - b), cells };
};

const poseAt = (frame: number, depth: number): Pose | undefined => {
  const timeline = shownTimeline();
  const placement = timeline
    ? displayList(timeline.frames, frame).find((each) => each.depth === depth)
    : undefined;

  return placement
    ? poseOf({
        token: '',
        character: placement.character,
        matrix: placement.matrix,
        translate: placement.translate,
        colorTransform:
          placement.alpha < 1
            ? ((Math.round(placement.alpha * 255) << 24) | 0xffffff) >>> 0
            : undefined,
      })
    : undefined;
};

const round = (value: number) => Math.round(value * 1000) / 1000;

const easingSelect = (value = 'linear'): HTMLSelectElement => {
  const element = document.createElement('select');

  element.append(...Object.keys(EASINGS).map((name) => new Option(name, name)));
  element.value = value;
  return element;
};

const textInput = (value: string, placeholder = ''): HTMLInputElement => {
  const element = document.createElement('input');

  element.type = 'text';
  element.value = value;
  element.placeholder = placeholder;
  element.className = 'short';
  return element;
};

const field = (name: string, control: HTMLElement): HTMLLabelElement => {
  const element = document.createElement('label');

  element.append(name + ' ', control);
  return element;
};

/** The end pose of a tween, filled with the pose at the range's end */
const tweenForm = (depth: number): HTMLElement => {
  const end = poseAt(selection.to, depth) ?? poseAt(selection.from, depth)!;
  const inputs = POSE_KEYS.map(
    (key) => [key, textInput(String(round(end[key])))] as const,
  );
  const easing = easingSelect(formEasing);
  const element = document.createElement('div');

  element.className = 'field';
  element.append(
    ...inputs.map(([key, control]) => field(key, control)),
    field('easing', easing),
    button('Apply', () => {
      const values = Object.fromEntries(
        inputs.map(([key, control]) => [key, Number(control.value)]),
      );

      if (Object.values(values).some((value) => !Number.isFinite(value))) {
        return;
      }
      run({
        op: 'tween',
        depth,
        from: selection.from,
        to: selection.to,
        end: values,
        easing: easing.value,
      });
    }),
  );
  return element;
};

/** A formula per property; an empty one leaves the property as it starts */
const formulaForm = (depth: number): HTMLElement => {
  const start = poseAt(selection.from, depth)!;
  const variables = {
    ...Object.fromEntries(POSE_KEYS.map((key) => [`${key}0`, start[key]])),
    t: 0.5,
    i: 1,
    n: 2,
    f: selection.from,
  };
  const inputs = POSE_KEYS.map(
    (key) => [key, textInput('', `${key}0`)] as const,
  );
  const easing = easingSelect();
  const error = document.createElement('span');
  const element = document.createElement('div');

  error.className = 'error-text';
  element.className = 'field';
  inputs.forEach(([, control]) => control.classList.replace('short', 'line'));
  element.append(
    ...inputs.map(([key, control]) => field(key, control)),
    field('easing for t', easing),
    button('Apply', () => {
      const formulas = Object.fromEntries(
        inputs
          .filter(([, control]) => control.value.trim())
          .map(([key, control]) => [key, control.value]),
      );

      try {
        Object.values(formulas).forEach((formula) =>
          compileExpression(formula)(variables),
        );
      } catch (problem) {
        error.textContent = (problem as Error).message;
        return;
      }
      run({
        op: 'animate',
        depth,
        from: selection.from,
        to: selection.to,
        formulas,
        easing: easing.value,
      });
    }),
    error,
  );
  element.title =
    't: 0 to 1 over the range, eased · i: frames since the start · n: frames in the range · f: the frame\n' +
    'x0, y0, scaleX0, scaleY0, rotation0 (degrees), skew0, alpha0 (0 to 1): the pose at the start\n' +
    '+ - * / % ^, sin cos tan asin acos atan atan2 sqrt abs min max pow floor ceil round exp log sign clamp lerp, pi, e';
  return element;
};

const SCRIPT_HELP = [
  '// depth 3, frames 0-20: x 0 -> 120 easeOut; alpha 1 -> 0',
  '// depth 3, frames 21-30: y = y0 - 40 * sin(t * pi)',
  '// depth 5, frames 10-15: fade   (or hide, show)',
  '// frames 30-40: retime 20      (or insert N, delete, duplicate, reverse)',
].join('\n');

/**
 * The motion script: starts as the tweens found in the timeline, runs as
 * one edit, and says which line is wrong before anything is sent
 */
const scriptForm = (tweens: DetectedTween[]): HTMLElement => {
  const element = document.createElement('div');
  const area = document.createElement('textarea');
  const error = document.createElement('div');

  area.className = 'code';
  area.rows = 8;
  area.spellcheck = false;
  area.value =
    scriptText ?? `${SCRIPT_HELP}\n${tweensAsScript(tweens)}`.trimEnd();
  area.oninput = () => (scriptText = area.value);
  error.className = 'error-text';
  element.append(
    area,
    button('Run', () => {
      const timeline = shownTimeline();

      try {
        const operations = parseMotionScript(area.value);

        if (timeline && operations.length) {
          send({ kind: 'timelineScript', timeline: timeline.id, operations });
        }
        error.textContent = '';
      } catch (problem) {
        error.textContent =
          problem instanceof MotionScriptError
            ? problem.message
            : String(problem);
      }
    }),
    button('From the timeline', () => {
      scriptText = undefined;
      showTimeline();
    }),
    error,
  );
  return element;
};

/** The tools for the selection; those needing one depth are off without it */
const toolbar = (frameCount: number): HTMLElement => {
  const { from, to, depth } = selection;
  const element = document.createElement('div');
  const count = textInput('1');
  const length = textInput(String(to - from + 1));
  const atDepth = depth !== undefined && !!poseAt(from, depth);
  const tool = (
    name: string,
    title: string,
    enabled: boolean,
    onClick: () => void,
  ) => {
    const control = button(name, onClick);

    control.title = title;
    control.disabled = !enabled;
    return control;
  };
  const nearest = () => {
    for (let frame = from - 1; frame >= 0; frame--) {
      if (poseAt(frame, depth!)) {
        return frame;
      }
    }
    for (let frame = to + 1; frame < frameCount; frame++) {
      if (poseAt(frame, depth!)) {
        return frame;
      }
    }
    return undefined;
  };
  const like = depth === undefined ? undefined : nearest();

  element.className = 'toolbar';
  element.append(
    Object.assign(document.createElement('span'), {
      textContent:
        `Frames ${from}–${to}` +
        (depth === undefined ? ', every depth' : `, depth ${depth}`),
    }),
    tool(
      'Tween…',
      'Move, scale, turn or fade from the pose at the first frame to an end pose',
      atDepth,
      () => {
        form = form === 'tween' ? undefined : 'tween';
        formEasing = 'linear';
        showTimeline();
      },
    ),
    tool('Formula…', 'Set properties by formulas of the frame', atDepth, () => {
      form = form === 'formula' ? undefined : 'formula';
      showTimeline();
    }),
    tool(
      'Script…',
      'The whole timeline as a few lines, like a CSS animation: edit and run it',
      true,
      () => {
        form = form === 'script' ? undefined : 'script';
        showTimeline();
      },
    ),
    tool(
      'Fade out',
      'Alpha 0 for the range; the instance stays, so its own animation goes on',
      depth !== undefined,
      () => run({ op: 'hide', depth: depth!, from, to, how: 'alpha' }),
    ),
    tool(
      'Remove',
      'Take it off the stage for the range; it is placed again afterwards',
      depth !== undefined,
      () => run({ op: 'hide', depth: depth!, from, to, how: 'remove' }),
    ),
    tool(
      'Show',
      `Show it for the range as it is in frame ${like ?? '?'}, fully opaque`,
      like !== undefined || atDepth,
      () =>
        run({
          op: 'show',
          depth: depth!,
          from,
          to,
          like: like ?? from,
        }),
    ),
    tool(
      'Insert',
      'Insert frames after the range, holding its last frame',
      true,
      () =>
        run({
          op: 'insert',
          at: to + 1,
          count: Math.trunc(Number(count.value)),
        }),
    ),
    count,
    tool(
      'Delete',
      'Delete the frames, with their scripts and labels',
      to - from + 1 < frameCount,
      () => run({ op: 'delete', from, to }),
    ),
    tool('Duplicate', 'Copy the frames after the range', true, () =>
      run({ op: 'duplicate', from, to }),
    ),
    tool('Reverse', 'Play the range backwards', to > from, () =>
      run({ op: 'reverse', from, to }),
    ),
    tool(
      'Retime to',
      'Stretch or squeeze the range to this many frames, interpolating motion',
      true,
      () =>
        run({
          op: 'retime',
          from,
          to,
          length: Math.trunc(Number(length.value)),
        }),
    ),
    length,
  );
  return element;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** What a baked tween does, for its cells' tooltip */
const describeTween = (tween: DetectedTween): string =>
  `Tween, frames ${tween.from}–${tween.to}, ${tween.easing}: ` +
  tween.changes
    .map(
      (key) => `${key} ${round2(tween.start[key])}→${round2(tween.end[key])}`,
    )
    .join(', ') +
  '. Double-click to edit it as one tween.';

/** Selects a baked tween's frames and opens it in the tween form */
const editTween = (tween: DetectedTween) => {
  select(tween.from, tween.depth, false);
  select(tween.to, tween.depth, true);
  form = 'tween';
  formEasing = tween.easing;
  showTimeline();
};

const select = (frame: number, depth: number | undefined, extend: boolean) => {
  if (extend) {
    selection.from = Math.min(selection.anchor, frame);
    selection.to = Math.max(selection.anchor, frame);
  } else {
    selection.anchor = selection.from = selection.to = frame;
  }
  selection.depth = depth;
  form = undefined;
  goToFrame(frame);
  if (depth !== undefined && poseAt(frame, depth)) {
    state.inspected = `/${depth}`;
  }
  showDetails();
  render();
  showTimeline();
};

/** Builds the panel for the timeline on the stage, or empties it */
export const showTimeline = (): void => {
  const timeline = shownTimeline();

  if (!timeline || view.interact) {
    panel.replaceChildren();
    return;
  }

  const frameCount = timeline.frames.length;

  selection.to = Math.min(selection.to, frameCount - 1);
  selection.from = Math.min(selection.from, selection.to);

  const { depths, cells } = cellsOf(timeline);
  const tweens = detectTweens(decodeTimeline(undefined, timeline.frames));
  const table = document.createElement('table');
  const head = table.insertRow();

  head.insertCell().textContent = 'depth';
  timeline.frames.forEach((frame, index) => {
    const cell = head.insertCell();
    const labels = frame.items.flatMap((item) =>
      item.type === 'frameLabel' ? [item.label] : [],
    );
    const scripts = frame.items.filter(
      (item) => item.type === 'action' || item.type === 'initAction',
    ).length;

    cell.className = 'frame';
    cell.dataset.frame = String(index);
    cell.textContent = labels.length
      ? '◆'
      : scripts
        ? 'a'
        : index % 5
          ? ''
          : String(index);
    cell.title =
      `Frame ${index}` +
      (labels.length ? `, labelled "${labels.join('", "')}"` : '') +
      (scripts ? `, ${scripts} script${scripts > 1 ? 's' : ''}` : '');
    cell.onclick = (event) => select(index, undefined, event.shiftKey);
  });

  for (const depth of depths) {
    const line = table.insertRow();
    const name = line.insertCell();

    name.textContent = String(depth);
    name.className = 'depth';
    cells.forEach((marks, frame) => {
      const cell = line.insertCell();
      const mark = marks.get(depth);
      const tween = tweens.find(
        (each) =>
          each.depth === depth && each.from <= frame && frame <= each.to,
      );

      cell.className = `cell ${mark ?? 'empty'}`;
      if (tween) {
        cell.classList.add('tween');
        if (frame === tween.from) {
          cell.classList.add('tween-start');
        }
        cell.title = describeTween(tween);
        cell.ondblclick = () => editTween(tween);
      }
      cell.dataset.frame = String(frame);
      if (
        frame >= selection.from &&
        frame <= selection.to &&
        (selection.depth === undefined || selection.depth === depth)
      ) {
        cell.classList.add('picked');
      }
      cell.onclick = (event) => select(frame, depth, event.shiftKey);
    });
  }

  const scroller = document.createElement('div');

  scroller.className = 'grid';
  scroller.append(table);

  const forms =
    form === 'script'
      ? [scriptForm(tweens)]
      : form &&
          selection.depth !== undefined &&
          poseAt(selection.from, selection.depth)
        ? [
            form === 'tween'
              ? tweenForm(selection.depth)
              : formulaForm(selection.depth),
          ]
        : [];
  const onion = document.createElement('select');

  onion.title = 'Onion skin: frames either side drawn faintly (N)';
  onion.append(
    ...[0, 1, 2, 3].map(
      (each) => new Option(each ? `onion ±${each}` : 'onion off', String(each)),
    ),
  );
  onion.value = String(view.onion);
  onion.onchange = () => setOnion(Number(onion.value));

  const bar = toolbar(frameCount);

  bar.prepend(onion);

  const previous = panel.querySelector('.grid')?.scrollLeft ?? 0;

  panel.replaceChildren(bar, ...forms, scroller);
  scroller.scrollLeft = previous;
  markPlayhead();
};

/** Sets how many frames either side the onion skin draws */
export const setOnion = (frames: number): void => {
  view.onion = frames;
  const control = panel.querySelector('select');

  if (control) {
    control.value = String(frames);
  }
  showMode();
  render();
};

/** Marks the shown frame's column, cheaply, on every frame drawn */
export const markPlayhead = (): void => {
  panel
    .querySelectorAll('.now')
    .forEach((cell) => cell.classList.remove('now'));
  panel
    .querySelectorAll(`[data-frame="${state.frame}"]`)
    .forEach((cell) => cell.classList.add('now'));
};
