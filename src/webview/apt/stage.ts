import type { Rect } from '../../formats/apt/aptMovie';
import { byId } from './dom';
import { paintLeaf } from './paint';
import { resolve } from './resolve';
import { boundsOf, collect, localBounds, transformRect, union } from './scene';
import type { Leaf, SceneOptions } from './scene';
import { movie, state } from './state';
import { framesOf } from './timeline';

/**
 * The stage: draws the selected character at the current tick on a canvas
 * sized once to everything the animation covers, so playing never resizes
 * or rescales it. What moves is shown by overlays instead: the origin of
 * the character's space, the box the current frame covers, and the box of
 * each child at this level, all measured from what is drawn.
 */

/** Ticks sampled past the root's own frames, for nested timelines */
const EXTRA_SAMPLES = 240;
const MAX_SAMPLES = 600;
const MARGIN = 16;

/** The modes the stage draws in; each has a hotkey and is printed on change */
export const view = {
  origin: true,
  boxes: true,
  honourStops: true,
  playing: false,
  fps: 30,
};

const stage = byId<HTMLCanvasElement>('stage');
const zoomSelect = byId<HTMLSelectElement>('zoom');
const frameInput = byId<HTMLInputElement>('frame');
const frameLabel = byId('frame-label');
const modeLabel = byId('mode');

/** The box the canvas covers, which only grows while one character is shown */
let extent: Rect | undefined;

const options = (): SceneOptions => ({ honourStops: view.honourStops });

/** The frames the selected character's own timeline has */
export const rootFrames = (): number => {
  const shown = resolve(movie(), state.selected);

  return shown ? framesOf(shown.movie, shown.character).length : 0;
};

/**
 * Measures what the animation covers over its frames, and a while past
 * them for nested timelines, so the canvas is sized once for all of it.
 * A movie is its screen.
 */
export const measure = (): void => {
  const source = movie();
  const shown = resolve(source, state.selected);

  if (shown?.character.type === 'movie') {
    extent = [
      0,
      0,
      shown.movie.record.screenWidth,
      shown.movie.record.screenHeight,
    ];
    return;
  }

  const samples = Math.min(MAX_SAMPLES, rootFrames() + EXTRA_SAMPLES);
  const boxes: Rect[] = [];

  for (let tick = 0; tick < samples; tick++) {
    const box = boundsOf(collect(source, state.selected, tick, options()));

    if (box) {
      boxes.push(box);
    }
  }
  extent = union([...boxes, [0, 0, 0, 0]]);
};

const formatRect = ([left, top, right, bottom]: Rect) =>
  `${round(right - left)}×${round(bottom - top)} at (${round(left)}, ${round(top)})`;
const round = (value: number) => Math.round(value * 10) / 10;

/** Prints the modes, in a form that pastes into a report */
export const showMode = (): void => {
  modeLabel.textContent = [
    view.playing ? `playing at ${view.fps} fps` : 'paused',
    `origin ${view.origin ? 'on' : 'off'}`,
    `boxes ${view.boxes ? 'on' : 'off'}`,
    `stop() ${view.honourStops ? 'honoured' : 'ignored'}`,
  ].join(' · ');
};

/** Draws the selected character at the current tick */
export const render = (): void => {
  const source = movie();
  const leaves = collect(source, state.selected, state.tick, options());
  const frameBox = boundsOf(leaves);

  if (!extent) {
    measure();
  }
  // A nested timeline that outgrows what was sampled widens the canvas once
  if (frameBox) {
    extent = union([extent!, frameBox]);
  }

  const [left, top, right, bottom] = extent!;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom =
    zoomSelect.value === 'fit'
      ? Math.min(
          4,
          Math.max(
            0.05,
            Math.min(
              (stage.parentElement!.clientWidth - 24) / (width + 2 * MARGIN),
              (window.innerHeight - 190) / (height + 2 * MARGIN),
            ),
          ),
        )
      : Number(zoomSelect.value);
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.ceil((width + 2 * MARGIN) * zoom * ratio);
  const pixelHeight = Math.ceil((height + 2 * MARGIN) * zoom * ratio);

  if (stage.width !== pixelWidth || stage.height !== pixelHeight) {
    stage.width = pixelWidth;
    stage.height = pixelHeight;
    stage.style.width = pixelWidth / ratio + 'px';
    stage.style.height = pixelHeight / ratio + 'px';
  }

  const ctx = stage.getContext('2d')!;
  const scale = zoom * ratio;
  const base: [number, number, number, number, number, number] = [
    scale,
    0,
    0,
    scale,
    (MARGIN - left) * scale,
    (MARGIN - top) * scale,
  ];

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);

  for (const leaf of leaves) {
    ctx.save();
    ctx.setTransform(...base);
    ctx.transform(...leaf.matrix);
    ctx.globalAlpha = leaf.alpha;
    paintLeaf(ctx, leaf);
    ctx.restore();
  }

  ctx.setTransform(...base);
  overlays(ctx, leaves, frameBox, scale, extent!);
  showFrame(frameBox);
};

/** The origin, the frame's box and each child's box, a pixel wide at any zoom */
const overlays = (
  ctx: CanvasRenderingContext2D,
  leaves: Leaf[],
  frameBox: Rect | undefined,
  scale: number,
  [left, top, right, bottom]: Rect,
) => {
  const pixel = (window.devicePixelRatio || 1) / scale;

  ctx.lineWidth = pixel;
  ctx.font = `${11 * pixel}px sans-serif`;
  ctx.textBaseline = 'bottom';

  if (view.boxes) {
    const byChild = new Map<number, Rect[]>();

    for (const leaf of leaves) {
      if (leaf.top !== undefined) {
        const boxes = byChild.get(leaf.top) ?? [];

        boxes.push(transformRect(leaf.matrix, localBounds(leaf)));
        byChild.set(leaf.top, boxes);
      }
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,200,255,0.55)';
    ctx.fillStyle = 'rgba(0,200,255,0.9)';
    for (const [depth, boxes] of byChild) {
      const [l, t, r, b] = union(boxes)!;

      ctx.strokeRect(l, t, r - l, b - t);
      ctx.fillText(`@${depth}`, l + 2 * pixel, t - pixel);
    }

    if (frameBox) {
      const [l, t, r, b] = frameBox;

      ctx.setLineDash([6 * pixel, 4 * pixel]);
      ctx.strokeStyle = 'rgba(255,220,0,0.95)';
      ctx.strokeRect(l, t, r - l, b - t);
    }
  }

  if (view.origin) {
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,60,60,0.8)';
    ctx.beginPath();
    ctx.moveTo(left - MARGIN, 0);
    ctx.lineTo(right + MARGIN, 0);
    ctx.moveTo(0, top - MARGIN);
    ctx.lineTo(0, bottom + MARGIN);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3 * pixel, 0, Math.PI * 2);
    ctx.stroke();
  }
};

/** The frame counter, with the box the frame covers */
const showFrame = (frameBox: Rect | undefined) => {
  const count = rootFrames();

  frameInput.value = String(state.frame);
  frameLabel.textContent =
    (count ? `frame ${state.frame} of ${count}` : 'no timeline') +
    (state.tick !== state.frame ? ` · tick ${state.tick}` : '') +
    (frameBox ? ` · ${formatRect(frameBox)}` : '');
};

/** Forgets the measured extent, for a new selection or a changed movie */
export const remeasure = (): void => {
  extent = undefined;
};

/** Shows the frame a tick lands on; the root plays its frames straight through */
export const setTick = (tick: number): void => {
  const count = rootFrames();

  state.tick = tick;
  state.frame = count ? tick % count : 0;
};

let lastTime: number | undefined;
let owed = 0;

const loop = (time: number) => {
  if (!view.playing) {
    lastTime = undefined;
    return;
  }

  owed += lastTime === undefined ? 0 : ((time - lastTime) / 1000) * view.fps;
  lastTime = time;

  // A tab that was hidden owes many frames; catch up at most a few
  const steps = Math.min(8, Math.floor(owed));

  if (steps > 0) {
    owed -= Math.floor(owed);
    setTick(state.tick + steps);
    render();
  }
  requestAnimationFrame(loop);
};

export const play = (playing: boolean): void => {
  view.playing = playing;
  owed = 0;
  byId('play').textContent = playing ? '⏸' : '▶';
  showMode();
  if (playing) {
    requestAnimationFrame(loop);
  }
};
