import type {
  FxListDef,
  NumericField,
} from '../../formats/particles/particleIni';
import { STEP_HZ } from '../../formats/particles/particleSimulation';
import { $, library, post, state, world } from './page';

/**
 * An FX list as a timeline: one row per nugget, a bar from when it starts
 * (its `InitialDelay`, shaded over the random range) for as long as its
 * system emits and its last particle lives, and the playhead at the
 * simulation's frame. A row lights while systems of its name are alive.
 * Each particle nugget can be muted or played alone, which restarts the
 * list without it, and its bar dragged to move its delay, previewed like
 * a slider. Nuggets the preview does not play are listed, greyed.
 */

const container = $('timeline');
const ROW = 20;
const LABEL = 96;
const PAD = 6;

/** Muted nugget indexes, and the one played alone */
const muted = new Set<number>();
let solo: number | undefined;
/** The list as the extension sent it, before muting */
let original: FxListDef | undefined;
let canvas: HTMLCanvasElement | undefined;
let drag:
  { nugget: number; startX: number; delays: [string, number][] } | undefined;

const rootList = () =>
  state.scene?.root?.kind === 'fxList'
    ? state.scene.fxLists[state.scene.root.name.toLowerCase()]
    : undefined;

/** Frames from a delay in milliseconds, as the simulation rounds them */
const delayFrames = (ms: number) => Math.ceil((ms * STEP_HZ) / 1000);

/** Frames a nugget's systems take: emitting, then their last particle's life */
const duration = (system: string): number | undefined => {
  const def = library.systems.get(system.toLowerCase());

  if (!def) {
    return undefined;
  }
  // SystemLifetime 0 emits until stopped; draw it to the edge
  return def.systemLifetime > 0
    ? def.systemLifetime + Math.max(def.lifetime.low, def.lifetime.high)
    : Number.POSITIVE_INFINITY;
};

/** The InitialDelay tokens of a nugget's module: one, or min and max */
const delayFields = (module: number): NumericField[] =>
  (state.scene?.fields ?? []).filter(
    (field) =>
      field.moduleIndex === module &&
      field.keyword.toLowerCase() === 'initialdelay',
  );

/** The list the world plays: the extension's, less muted nuggets */
const playedList = (list: FxListDef): FxListDef => ({
  ...list,
  nuggets: list.nuggets.filter((_, index) =>
    solo !== undefined ? index === solo : !muted.has(index),
  ),
});

/** Puts the muting into the library */
export const applyMuting = (): void => {
  const list = rootList();

  original = list;
  if (list) {
    library.fxLists.set(list.name.toLowerCase(), playedList(list));
  }
};

const span = (list: FxListDef): number => {
  const ends = list.nuggets.map((nugget) => {
    const end = duration(nugget.system);

    return delayFrames(nugget.initialDelay.high) + (end ?? 0);
  });
  const finite = ends.filter(Number.isFinite);

  return Math.max(
    STEP_HZ * 2,
    world.frame + STEP_HZ / 2,
    ...finite,
    ...(finite.length < ends.length ? [STEP_HZ * 4] : []),
  );
};

/** Draws the rows and the playhead; called every frame */
export const drawTimeline = (): void => {
  const list = original;

  if (!list || !canvas) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const rows = list.nuggets.length + list.skipped.length;
  const height = PAD * 2 + Math.max(1, rows) * ROW + 12;

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext('2d')!;
  const frames = span(list);
  const x = (frame: number) =>
    LABEL + (Math.min(frame, frames) / frames) * (width - LABEL - PAD);

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(24, 24, 24, 0.9)';
  ctx.fillRect(0, 0, width, height);
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';

  // Seconds along the bottom
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let second = 0; second * STEP_HZ <= frames; second++) {
    const at = x(second * STEP_HZ);

    ctx.fillRect(at, PAD, 1, rows * ROW);
    ctx.fillText(`${second}s`, at + 2, height - 8);
  }

  const alive = new Map<string, number>();

  for (const system of world.systems) {
    const key = system.name.toLowerCase();

    alive.set(key, (alive.get(key) ?? 0) + system.particles.length);
  }

  list.nuggets.forEach((nugget, index) => {
    const top = PAD + index * ROW;
    const off = solo !== undefined ? index !== solo : muted.has(index);
    const start = delayFrames(nugget.initialDelay.low);
    const late = delayFrames(nugget.initialDelay.high);
    const length = duration(nugget.system);
    const live = alive.get(nugget.system.toLowerCase()) ?? 0;

    ctx.fillStyle = off ? 'rgba(255,255,255,0.35)' : '#ddd';
    ctx.fillText(
      (nugget.count > 1 ? `${nugget.count}× ` : '') + nugget.system,
      4,
      top + ROW / 2,
      LABEL - 8,
    );
    if (length === undefined) {
      ctx.fillStyle = '#f66';
      ctx.fillText('not found', x(start) + 2, top + ROW / 2);
      return;
    }
    ctx.fillStyle = off
      ? 'rgba(120,120,120,0.4)'
      : live
        ? 'rgba(255, 204, 51, 0.9)'
        : 'rgba(255, 204, 51, 0.45)';
    ctx.fillRect(x(start), top + 4, x(late + length) - x(start), ROW - 8);
    if (late > start) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x(start), top + 4, x(late) - x(start), ROW - 8);
    }
    if (!Number.isFinite(length)) {
      ctx.fillStyle = '#000';
      ctx.fillText('→', width - PAD - 12, top + ROW / 2);
    }
  });
  list.skipped.forEach((name, index) => {
    const top = PAD + (list.nuggets.length + index) * ROW;

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(`${name} (not previewed)`, 4, top + ROW / 2);
  });

  const head = x(world.frame);

  ctx.fillStyle = '#4af';
  ctx.fillRect(head, PAD - 2, 2, rows * ROW + 4);
};

/** The nugget row under a point, if a particle nugget */
const rowAt = (y: number) => {
  const index = Math.floor((y - PAD) / ROW);

  return original && index >= 0 && index < original.nuggets.length
    ? index
    : undefined;
};

let clearButton: HTMLButtonElement | undefined;

/**
 * Builds the timeline for an FX list once, or empties it for a system;
 * later scenes only refresh it, so a drag survives them. `restart` starts
 * the list over.
 */
export const renderTimeline = (restart: () => void): void => {
  const list = rootList();

  if (!list) {
    container.replaceChildren();
    canvas = undefined;
    return;
  }
  applyMuting();
  if (canvas && clearButton) {
    clearButton.disabled = !muted.size && solo === undefined;
    return;
  }

  const view = document.createElement('canvas');
  const heading = document.createElement('div');
  const clear = document.createElement('button');
  const replay = () => {
    applyMuting();
    restart();
    clear.disabled = !muted.size && solo === undefined;
  };

  view.className = 'curve';
  view.style.width = '100%';
  view.title =
    'Click a name to mute it, shift-click to play it alone; drag a bar to move its InitialDelay';
  heading.className = 'curve-heading';
  heading.textContent = 'Timeline ';
  clear.textContent = 'Play all';
  clear.onclick = () => {
    muted.clear();
    solo = undefined;
    replay();
  };
  heading.append(clear);

  view.addEventListener('pointerdown', (event) => {
    const box = view.getBoundingClientRect();
    const index = rowAt(event.clientY - box.top);

    if (index === undefined) {
      return;
    }
    if (event.clientX - box.left < LABEL) {
      if (event.shiftKey) {
        solo = solo === index ? undefined : index;
      } else if (!muted.delete(index)) {
        muted.add(index);
      }
      replay();
      return;
    }

    const delays = delayFields(original!.nuggets[index].module);

    if (!delays.length) {
      return;
    }
    view.setPointerCapture(event.pointerId);
    drag = {
      nugget: index,
      startX: event.clientX,
      delays: delays.map((field) => [
        field.id,
        state.scene?.values[field.id] ?? field.value,
      ]),
    };
  });
  view.addEventListener('pointermove', (event) => {
    if (!drag || !original) {
      return;
    }

    const width = view.clientWidth - LABEL - PAD;
    const ms =
      ((event.clientX - drag.startX) / width) *
      (span(original) / STEP_HZ) *
      1000;

    for (const [id, value] of drag.delays) {
      const next = Math.max(0, Math.round((value + ms) / 10) * 10);

      if (state.scene) {
        state.scene.values[id] = next;
      }
      post({ kind: 'set', id, value: next });
    }
  });
  view.addEventListener('pointerup', () => (drag = undefined));
  canvas = view;
  clearButton = clear;
  clear.disabled = !muted.size && solo === undefined;
  container.replaceChildren(heading, view);
};
