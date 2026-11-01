import { engine, onEngineLog, watchMovie } from "./engineState";
import { fetchMovie } from "./movieLoads";
import type { Rect } from "../../formats/apt/aptMovie";
import { byId } from "./dom";
import { BACKDROP_CALL } from "../../game/apt/engineImages";
import { findGadgetOf, isEngineSurface } from "./gadgetModel";
import { paintBackdrop, paintImageSurface } from "./imageSurface";
import { buildMaskArea, paintLeaf } from "./paint";
import { Player } from "./player";
import type { Instance } from "./instance";
import { resolve } from "./resolve";
import {
  getLeafBounds,
  collect,
  getLocalBounds,
  transformRect,
  union,
} from "./scene";
import { growExtent } from "./stageExtent";
import { fitZoom, getFitSpace } from "./stageFit";
import { attachStagePointer } from "./stagePointer";
import type { StageTool } from "./stagePointer";
import { isDrawnAt } from "./hitTest";
import type { Affine, HitArea, Leaf } from "./scene";
import { movie, state } from "./state";
import { paintView3d } from "./view3dSurface";

/**
 * The stage: plays the selected character on a canvas sized once to
 * everything it covers, so playing never resizes or rescales it. What
 * moves is shown by overlays: the origin, the box the frame covers and
 * each child's box at this level, all measured from what is drawn.
 *
 * Two modes. Inspect steps through the shown timeline's own frames;
 * pointing highlights an instance and clicking selects it for the
 * inspector. Interact runs everything as the game does, and the pointer
 * drives the buttons.
 */

const EXTRA_SAMPLES = 240;
const MAX_SAMPLES = 600;
const MARGIN = 16;
const LOG_LINES = 8;

/** Frames a second the game plays a movie at, which speed 1 is */
const FRAME_RATE = 30;

/** Display modes of the stage; each has a hotkey and is printed on change */
export const view = {
  origin: true,
  wireframe: false,
  /** Frames either side of the shown one, drawn faintly behind it */
  onion: 0,
  boxes: true,
  /**
   * Whether clip masks cut what they cover, as the game draws it; off shows
   * everything, faint outside its mask, with the masks outlined
   */
  masks: true,
  /** Whether frame scripts stop and jump timelines, as in the game */
  scripts: true,
  interact: false,
  playing: false,
  /** Playback speed: 1 is the game's 30 frames a second */
  speed: 1,
};

const stage = byId<HTMLCanvasElement>("stage");
const zoomSelect = byId<HTMLSelectElement>("zoom");
const frameInput = byId<HTMLInputElement>("frame");
const frameLabel = byId("frame-label");
const modeLabel = byId("mode");
const logList = byId("log");

/** Called when the inspected instance changes, to show it */
let onInspect: () => void = () => {};
let onRendered: () => void = () => {};

/** Extra drawing after each render, in the shown character's space (gadget surfaces) */
const afterRender: ((ctx: CanvasRenderingContext2D, base: Affine) => void)[] = [];

/** Adds drawing run after each render, in the shown character's space */
export const addRenderHook = (
  hook: (ctx: CanvasRenderingContext2D, base: Affine) => void,
): void => {
  afterRender.push(hook);
};

/** Sets how the stage tells the inspector of a new pick, and of each frame drawn */
export const setInspectorView = (
  show: () => void,
  update: () => void,
): void => {
  onInspect = show;
  onRendered = update;
};

/** Tools in the order they are offered the pointer */
const tools: StageTool[] = [];

/** Adds a tool; one added later is asked first */
export const addTool = (next: StageTool): void => {
  tools.unshift(next);
};

let player: Player | undefined;
let extent: Rect | undefined;
let scene: { leaves: Leaf[]; hits: HitArea[] } = { leaves: [], hits: [] };
let base: Affine = [1, 0, 0, 1, 0, 0];
const log: string[] = [];
/** What other frames of the shown timeline draw, for onion skinning */
const ghosts = new Map<number, Leaf[]>();

const ghostOf = (frame: number): Leaf[] => {
  let leaves = ghosts.get(frame);

  if (!leaves) {
    const ghost = newPlayer(false, false);

    while (ghost.ticks < frame) {
      ghost.tick();
    }
    leaves = collect(ghost).leaves;
    ghosts.set(frame, leaves);
  }
  return leaves;
};

/**
 * A player of the shown character. The logged one is the one on the stage:
 * its scripts run on the AVM and ask the engine panel what the game would
 * answer. Others (onion skin, measuring) only play what scripts do to
 * timelines, so they neither log nor ask.
 */
const newPlayer = (rootScripts: boolean, logged: boolean) => {
  if (logged) {
    watchMovie(movie());
  }
  return new Player(movie(), state.selected, {
    resolve,
    scripts: view.scripts,
    rootScripts,
    log: logged ? addLog : undefined,
    engine: logged ? engine : undefined,
    fetchMovie: logged ? fetchMovie : undefined,
  });
};

const addLog = (line: string): void => {
  log.push(line);
  log.splice(0, Math.max(0, log.length - LOG_LINES));
  logList.replaceChildren(
    ...log.map((text) => {
      const element = document.createElement("div");

      element.textContent = text;
      return element;
    }),
  );
};

/**
 * Whether the shown timeline's own frame scripts run: a stop stops it and
 * a goto jumps, as in the game, unless scripts are ignored
 */
const rootScriptsRun = () => view.interact || view.scripts;

onEngineLog((line) => addLog(line));

/** Gets the player of the shown character, built on first use */
export const currentPlayer = (): Player => {
  player ??= newPlayer(rootScriptsRun(), true);
  return player;
};

/** Starts the shown character over, for a new selection, mode or movie */
export const restart = (): void => {
  player = undefined;
  ghosts.clear();
  extent = undefined;
  stagePointer.reset();
  state.inspected = undefined;
};

/** Sizes the canvas again from what is drawn, after a mode changes what that is */
export const remeasure = (): void => {
  extent = undefined;
};

/** Counts the frames of the shown character's own timeline */
export const rootFrames = (): number => currentPlayer().root.frames.length;

/**
 * Shows a frame of the shown timeline. With scripts running it jumps there
 * and runs that frame's script, as a goto does; with them ignored it
 * replays from the start, so nested timelines are where they would be.
 */
export const goToFrame = (frame: number): void => {
  const count = rootFrames();
  const target = count ? Math.max(0, Math.min(count - 1, frame)) : 0;

  if (rootScriptsRun()) {
    const root = currentPlayer().root;

    if (target === root.frame) {
      // Already there: a stop() the frame's script ran stays, a pause is kept
      root.playing = root.playing && view.playing;
    } else {
      currentPlayer().goTo(root, target, view.playing);
    }
  } else {
    if (target < currentPlayer().root.frame || currentPlayer().ticks > target) {
      player = newPlayer(false, true);
    }
    while (currentPlayer().ticks < target) {
      currentPlayer().tick();
    }
  }
  state.frame = currentPlayer().root.frame;
};

/** Measures what the animation covers over a while of playing; a movie is its screen */
const measure = (): Rect => {
  const shown = resolve(movie(), state.selected);

  if (shown?.character.type === "movie") {
    return [
      0,
      0,
      shown.movie.record.screenWidth,
      shown.movie.record.screenHeight,
    ];
  }

  const sample = newPlayer(false, false);
  const samples = Math.min(
    MAX_SAMPLES,
    sample.root.frames.length + EXTRA_SAMPLES,
  );
  const boxes: Rect[] = [];

  for (let tick = 0; tick < samples; tick++) {
    const box = getLeafBounds(collect(sample).leaves, view.masks);

    if (box) {
      boxes.push(box);
    }
    sample.tick();
  }
  return union([...boxes, [0, 0, 0, 0]])!;
};

const round = (value: number) => Math.round(value * 10) / 10;
const formatRect = ([left, top, right, bottom]: Rect) =>
  `${round(right - left)}×${round(bottom - top)} at (${round(left)}, ${round(top)})`;

/** Prints the modes, in a form that pastes into a report */
export const showMode = (): void => {
  modeLabel.textContent = [
    view.interact ? "interact" : "inspect",
    view.playing
      ? `playing at ${view.speed}× (${Math.round(FRAME_RATE * view.speed * 10) / 10} frames/s)`
      : `paused at ${view.speed}×`,
    `origin ${view.origin ? "on" : "off"}`,
    `boxes ${view.boxes ? "on" : "off"}`,
    `masks ${view.masks ? "applied" : "shown"}`,
    `action scripts ${view.scripts ? "respected" : "ignored"}`,
    `wireframe ${view.wireframe ? "on" : "off"}`,
    `onion ${view.onion ? `±${view.onion}` : "off"}`,
  ].join(" · ");
};

/** Gets what is drawn now, in paint order */
export const getSceneLeaves = (): Leaf[] => scene.leaves;

/** Gets the extent the canvas shows, for snapping to its edges */
export const getStageExtent = (): Rect | undefined => extent;

/** Gets how many of the shown character's units one screen pixel is */
export const getPixelSize = (): number =>
  1 / (base[0] / (window.devicePixelRatio || 1));

/** The instance a stage leaf belongs to that is worth inspecting: a timeline or button */
const inspectable = (leaf: Leaf, deep: boolean): Instance => {
  let at: Instance = leaf.instance;

  if (!deep) {
    // What the shown timeline itself places, as an editor selects first
    while (at.parent && at.parent !== currentPlayer().root) {
      at = at.parent;
    }
    return at;
  }
  // The innermost sprite or button, for reaching inside
  while (
    at.parent &&
    !["sprite", "button"].includes(at.character?.type ?? "")
  ) {
    at = at.parent;
  }
  return at;
};

/** Measures the box an instance covers now, from what it draws */
export const measureInstanceBox = (instance: Instance): Rect | undefined =>
  getLeafBounds(
    scene.leaves.filter((leaf) => {
      for (let at: Instance | undefined = leaf.instance; at; at = at.parent) {
        if (at === instance) {
          return true;
        }
      }
      return false;
    }),
  );

/** How strongly what a mask hides shows when the masks are shown */
const HIDDEN_ALPHA = 0.25;

/** Every mask drawn now, once each, outlined over the stage */
const outlineMasks = (ctx: CanvasRenderingContext2D) => {
  const masks = new Set(scene.leaves.flatMap((leaf) => leaf.masks ?? []));

  ctx.save();
  ctx.setTransform(...base);
  ctx.lineWidth = 2 / base[0];
  ctx.setLineDash([6 / base[0], 4 / base[0]]);
  ctx.strokeStyle = "rgba(0, 220, 255, 0.95)";
  ctx.fillStyle = "rgba(0, 220, 255, 0.08)";
  for (const mask of masks) {
    const area = buildMaskArea(mask);

    ctx.fill(area);
    ctx.stroke(area);
  }
  ctx.restore();
};

let drawPass = 0;

/** Paints a leaf, an engine surface by what the engine draws in it */
const paintOnStage = (ctx: CanvasRenderingContext2D, leaf: Leaf): void => {
  const current = currentPlayer();
  const gadget = leaf.surfaceBox && findGadgetOf(current, leaf.instance);

  if (!gadget) {
    paintLeaf(ctx, leaf);
  } else if (gadget.kind === "image") {
    paintImageSurface(ctx, leaf, gadget, leaf.surfaceBox!);
  } else if (gadget.kind === "view3d") {
    paintView3d(ctx, gadget, leaf.surfaceBox!, {
      player: current,
      pass: drawPass,
      isPlaying: view.playing,
    });
  }
};

/** Draws the shown character as the player has it now */
export const render = (): void => {
  const current = currentPlayer();

  drawPass++;
  scene = collect(current, (instance) => isEngineSurface(current, instance));

  const frameBox = getLeafBounds(scene.leaves, view.masks);

  extent ??= measure();
  extent = growExtent(extent, frameBox, {
    isScreen: resolve(movie(), state.selected)?.character.type === "movie",
    isAnimating: view.playing || view.interact,
  });

  const [left, top, right, bottom] = extent;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom =
    zoomSelect.value === "fit"
      ? fitZoom(getFitSpace(stage, window.innerHeight), { width, height }, MARGIN)
      : Number(zoomSelect.value);
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.ceil((width + 2 * MARGIN) * zoom * ratio);
  const pixelHeight = Math.ceil((height + 2 * MARGIN) * zoom * ratio);

  if (stage.width !== pixelWidth || stage.height !== pixelHeight) {
    stage.width = pixelWidth;
    stage.height = pixelHeight;
    stage.style.width = pixelWidth / ratio + "px";
    stage.style.height = pixelHeight / ratio + "px";
  }

  const ctx = stage.getContext("2d")!;
  const scale = zoom * ratio;

  base = [scale, 0, 0, scale, (MARGIN - left) * scale, (MARGIN - top) * scale];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);

  const shown = resolve(movie(), state.selected);

  if (shown?.character.type === "movie" && engine.calls.has(BACKDROP_CALL.toLowerCase())) {
    const { screenWidth, screenHeight } = shown.movie.record;

    ctx.save();
    ctx.setTransform(...base);
    paintBackdrop(ctx, [0, 0, screenWidth, screenHeight]);
    ctx.restore();
  }

  // Onion skin: neighbours by replaying, so it shows only when inspecting a still frame
  if (view.onion && !view.interact && !view.playing) {
    const root = current.root.frame;

    for (let offset = -view.onion; offset <= view.onion; offset++) {
      const frame = root + offset;

      if (!offset || frame < 0 || frame >= current.root.frames.length) {
        continue;
      }
      for (const leaf of ghostOf(frame)) {
        ctx.save();
        ctx.setTransform(...base);
        ctx.transform(...leaf.matrix);
        ctx.globalAlpha = (leaf.alpha * 0.3) / Math.abs(offset);
        paintLeaf(ctx, leaf);
        ctx.restore();
      }
    }
  }
  for (const leaf of scene.leaves) {
    // With the masks shown, what a mask hides is drawn faintly too
    if (!view.masks && leaf.masks) {
      ctx.save();
      ctx.setTransform(...base);
      ctx.transform(...leaf.matrix);
      ctx.globalAlpha = leaf.alpha * HIDDEN_ALPHA;
      paintOnStage(ctx, leaf);
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(...base);
    for (const mask of leaf.masks ?? []) {
      // An empty mask clips to nothing; mint skips it (`allow_as_mask`)
      if (!mask.length) {
        continue;
      }
      ctx.clip(buildMaskArea(mask));
    }
    ctx.transform(...leaf.matrix);
    ctx.globalAlpha = leaf.alpha;
    paintOnStage(ctx, leaf);
    ctx.restore();
  }
  if (!view.masks) {
    outlineMasks(ctx);
  }

  ctx.setTransform(...base);
  overlays(ctx, frameBox, scale, extent);
  showFrame(frameBox);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  afterRender.forEach((hook) => hook(ctx, base));
  onRendered();
};

/** The origin, the frame's box, each child's box, and the instances pointed at */
const overlays = (
  ctx: CanvasRenderingContext2D,
  frameBox: Rect | undefined,
  scale: number,
  [left, top, right, bottom]: Rect,
) => {
  const pixel = (window.devicePixelRatio || 1) / scale;
  const box = ([l, t, r, b]: Rect) => ctx.strokeRect(l, t, r - l, b - t);

  ctx.lineWidth = pixel;
  ctx.font = `${11 * pixel}px sans-serif`;
  ctx.textBaseline = "bottom";

  if (view.boxes) {
    const byChild = new Map<number, Rect[]>();

    for (const leaf of scene.leaves) {
      if (leaf.top !== undefined) {
        const boxes = byChild.get(leaf.top) ?? [];

        boxes.push(transformRect(leaf.matrix, getLocalBounds(leaf)));
        byChild.set(leaf.top, boxes);
      }
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0,200,255,0.55)";
    ctx.fillStyle = "rgba(0,200,255,0.9)";
    for (const [depth, boxes] of byChild) {
      const rect = union(boxes)!;

      box(rect);
      ctx.fillText(`@${depth}`, rect[0] + 2 * pixel, rect[1] - pixel);
    }

    if (frameBox) {
      ctx.setLineDash([6 * pixel, 4 * pixel]);
      ctx.strokeStyle = "rgba(255,220,0,0.95)";
      box(frameBox);
    }
  }

  if (view.origin) {
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,60,60,0.8)";
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

  for (const each of [...tools].reverse()) {
    ctx.save();
    each.draw(ctx, pixel);
    ctx.restore();
  }

  ctx.setLineDash([]);
  for (const [instance, colour, width] of [
    [stagePointer.getHovered(), "rgba(255,0,255,0.6)", 1],
    [getInspectedInstance(), "rgba(255,0,255,1)", 2],
  ] as const) {
    const rect = instance && measureInstanceBox(instance);

    if (rect) {
      ctx.lineWidth = pixel * width;
      ctx.strokeStyle = colour;
      box(rect);
    }
  }
};

/** Gets the instance the inspector shows, if it is still there */
export const getInspectedInstance = (): Instance | undefined =>
  state.inspected === undefined
    ? undefined
    : currentPlayer().find(state.inspected);

const showFrame = (frameBox: Rect | undefined) => {
  const count = rootFrames();
  const ticks = currentPlayer().ticks;

  frameInput.value = String(state.frame);
  frameLabel.textContent =
    (count ? `frame ${state.frame} of ${count}` : "no timeline") +
    (ticks !== state.frame ? ` · tick ${ticks}` : "") +
    (frameBox ? ` · ${formatRect(frameBox)}` : "");
};

/** Converts a pointer event's position on the canvas to the shown character's space */
export const pointAt = (event: MouseEvent): [number, number] => {
  const ratio = window.devicePixelRatio || 1;

  return [
    (event.offsetX * ratio - base[4]) / base[0],
    (event.offsetY * ratio - base[5]) / base[3],
  ];
};

/** The topmost instance worth inspecting under the point */
const findInstanceAt = (
  point: [number, number],
  deep = false,
): Instance | undefined => {
  for (let index = scene.leaves.length - 1; index >= 0; index--) {
    if (isDrawnAt(scene.leaves[index], point)) {
      return inspectable(scene.leaves[index], deep);
    }
  }
  return undefined;
};

const stagePointer = attachStagePointer(stage, {
  tools,
  isInteractive: () => view.interact,
  hasMovie: () => !!state.movie,
  getPlayer: currentPlayer,
  getHits: () => scene.hits,
  pointAt,
  findInstanceAt,
  inspect: (instance) => {
    state.inspected = instance?.path;
    onInspect();
    render();
  },
  render,
});

let lastTime: number | undefined;
let owed = 0;

const loop = (time: number) => {
  if (!view.playing) {
    lastTime = undefined;
    return;
  }

  owed +=
    lastTime === undefined
      ? 0
      : ((time - lastTime) / 1000) * FRAME_RATE * view.speed;
  lastTime = time;

  // A tab that was hidden owes many frames; catch up at most a few
  const steps = Math.min(8, Math.floor(owed));

  if (steps > 0) {
    owed -= Math.floor(owed);
    for (let step = 0; step < steps; step++) {
      currentPlayer().tick();
    }
    state.frame = currentPlayer().root.frame;
    render();
    if (stagePointer.updateAfterFrame()) {
      render();
    }
  }
  requestAnimationFrame(loop);
};

/**
 * Plays the shown timeline from a frame, freshly started there and with
 * that frame's script run: where its scripts stop it, it stops, while
 * what plays inside it goes on
 */
export const playFrom = (frame: number): void => {
  player = undefined;
  if (frame) {
    currentPlayer().goTo(currentPlayer().root, frame, true);
  }
  state.frame = currentPlayer().root.frame;
  play(true);
  render();
};

/** Starts or pauses playback, and shows which on the play button and the mode line */
export const play = (playing: boolean): void => {
  view.playing = playing;
  owed = 0;
  byId("play").textContent = playing ? "⏸" : "▶";
  showMode();
  if (playing) {
    requestAnimationFrame(loop);
  }
};
