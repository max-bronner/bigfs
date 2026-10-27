import { engine, onEngineLog, watchMovie } from "./engineState";
import { fetchMovie } from "./movieLoads";
import type { Rect } from "../../formats/apt/aptMovie";
import { byId } from "./dom";
import { maskArea, paintLeaf } from "./paint";
import { Player } from "./player";
import type { Instance } from "./player";
import { resolve } from "./resolve";
import { boundsOf, collect, localBounds, transformRect, union } from "./scene";
import type { Affine, HitArea, Leaf } from "./scene";
import { movie, state } from "./state";

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

/** The modes the stage draws in; each has a hotkey and is printed on change */
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

/** How the stage tells the inspector: a new pick, and each frame drawn */
export const setInspectorView = (
  show: () => void,
  update: () => void,
): void => {
  onInspect = show;
  onRendered = update;
};

/** A tool that can take the pointer before the stage picks, and draw on top */
export interface StageTool {
  /** Takes a press; false lets the stage pick as usual */
  down(point: [number, number], event: MouseEvent): boolean;
  /** Takes a move while it holds the pointer */
  move(point: [number, number], event: MouseEvent): boolean;
  up(): void;
  /** Draws in the shown character's space, `pixel` wide lines */
  draw(ctx: CanvasRenderingContext2D, pixel: number): void;
  /** The cursor over a point, when the tool has one */
  cursor(point: [number, number]): string | undefined;
}

/** Tools in the order they are offered the pointer */
const tools: StageTool[] = [];

/** Adds a tool; one added later is asked first */
export const addTool = (next: StageTool): void => {
  tools.unshift(next);
};

/** The tool that holds the pointer, while a drag lasts */
let holder: StageTool | undefined;

let player: Player | undefined;
let extent: Rect | undefined;
let scene: { leaves: Leaf[]; hits: HitArea[] } = { leaves: [], hits: [] };
let base: Affine = [1, 0, 0, 1, 0, 0];
let hovered: Instance | undefined;
let pressed: Instance | undefined;
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

/** The player of the shown character, built on first use */
export const currentPlayer = (): Player => {
  player ??= newPlayer(rootScriptsRun(), true);
  return player;
};

/** Starts the shown character over, for a new selection, mode or movie */
export const restart = (): void => {
  player = undefined;
  ghosts.clear();
  extent = undefined;
  hovered = undefined;
  pressed = undefined;
  state.inspected = undefined;
};

/** Sizes the canvas again from what is drawn, after a mode changes what that is */
export const remeasure = (): void => {
  extent = undefined;
};

/** The frames of the shown character's own timeline */
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
    const box = boundsOf(collect(sample).leaves, view.masks);

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

/** What is drawn now, in paint order */
export const sceneLeaves = (): Leaf[] => scene.leaves;

/** The extent the canvas shows, for snapping to its edges */
export const stageExtent = (): Rect | undefined => extent;

/** How many of the shown character's units one screen pixel is */
export const pixelSize = (): number =>
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

/** The box an instance covers now, from what it draws */
export const instanceBox = (instance: Instance): Rect | undefined =>
  boundsOf(
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
    const area = maskArea(mask);

    ctx.fill(area);
    ctx.stroke(area);
  }
  ctx.restore();
};

/** Draws the shown character as the player has it now */
export const render = (): void => {
  const current = currentPlayer();

  scene = collect(current);

  const frameBox = boundsOf(scene.leaves, view.masks);

  extent ??= measure();
  if (frameBox) {
    extent = union([extent, frameBox])!;
  }

  const [left, top, right, bottom] = extent;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom =
    zoomSelect.value === "fit"
      ? Math.min(
          4,
          Math.max(
            0.05,
            Math.min(
              (stage.parentElement!.clientWidth - 24) / (width + 2 * MARGIN),
              (window.innerHeight - 230) / (height + 2 * MARGIN),
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
    stage.style.width = pixelWidth / ratio + "px";
    stage.style.height = pixelHeight / ratio + "px";
  }

  const ctx = stage.getContext("2d")!;
  const scale = zoom * ratio;

  base = [scale, 0, 0, scale, (MARGIN - left) * scale, (MARGIN - top) * scale];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, stage.width, stage.height);

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
      paintLeaf(ctx, leaf);
      ctx.restore();
    }
    ctx.save();
    ctx.setTransform(...base);
    for (const mask of leaf.masks ?? []) {
      // An empty mask clips to nothing; mint skips it (`allow_as_mask`)
      if (!mask.length) {
        continue;
      }
      ctx.clip(maskArea(mask));
    }
    ctx.transform(...leaf.matrix);
    ctx.globalAlpha = leaf.alpha;
    paintLeaf(ctx, leaf);
    ctx.restore();
  }
  if (!view.masks) {
    outlineMasks(ctx);
  }

  ctx.setTransform(...base);
  overlays(ctx, frameBox, scale, extent);
  showFrame(frameBox);
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

        boxes.push(transformRect(leaf.matrix, localBounds(leaf)));
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
    [hovered, "rgba(255,0,255,0.6)", 1],
    [inspected(), "rgba(255,0,255,1)", 2],
  ] as const) {
    const rect = instance && instanceBox(instance);

    if (rect) {
      ctx.lineWidth = pixel * width;
      ctx.strokeStyle = colour;
      box(rect);
    }
  }
};

/** The instance the inspector shows, if it is still there */
export const inspected = (): Instance | undefined =>
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

/** A point on the canvas, in the shown character's space */
export const pointAt = (event: MouseEvent): [number, number] => {
  const ratio = window.devicePixelRatio || 1;

  return [
    (event.offsetX * ratio - base[4]) / base[0],
    (event.offsetY * ratio - base[5]) / base[3],
  ];
};

/** Whether a leaf covers a point: a shape by its triangles, the rest by their box */
const covers = (leaf: Leaf, [x, y]: [number, number]): boolean => {
  const [a, b, c, d, tx, ty] = leaf.matrix;
  const det = a * d - b * c;

  if (!det) {
    return false;
  }

  const lx = (d * (x - tx) - c * (y - ty)) / det;
  const ly = (a * (y - ty) - b * (x - tx)) / det;

  if (leaf.character?.type === "shape") {
    return (leaf.movie.shapes[leaf.id] ?? []).some((run) => {
      const t = run.triangles;

      for (let i = 0; i < t.length; i += 6) {
        if (
          inTriangle(
            lx,
            ly,
            t[i],
            t[i + 1],
            t[i + 2],
            t[i + 3],
            t[i + 4],
            t[i + 5],
          )
        ) {
          return true;
        }
      }
      return false;
    });
  }

  const [l, top, r, bottom] = localBounds(leaf);

  return lx >= l && lx <= r && ly >= top && ly <= bottom;
};

const inTriangle = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean => {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);

  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** The topmost button whose hit area is under the point */
const buttonAt = (point: [number, number]): Instance | undefined => {
  for (let index = scene.hits.length - 1; index >= 0; index--) {
    if (covers(scene.hits[index].leaf, point)) {
      return scene.hits[index].button;
    }
  }
  return undefined;
};

/** The topmost instance worth inspecting under the point */
const instanceAt = (
  point: [number, number],
  deep = false,
): Instance | undefined => {
  for (let index = scene.leaves.length - 1; index >= 0; index--) {
    if (covers(scene.leaves[index], point)) {
      return inspectable(scene.leaves[index], deep);
    }
  }
  return undefined;
};

stage.addEventListener("mousemove", (event) => {
  if (!state.movie) {
    return;
  }

  const point = pointAt(event);

  if (!view.interact && holder?.move(point, event)) {
    return;
  }

  if (view.interact) {
    const next = buttonAt(point);

    if (next !== hovered) {
      currentPlayer().hover(hovered, next);
      hovered = next;
      render();
    }
    stage.style.cursor = next ? "pointer" : "default";
  } else {
    const next = instanceAt(point);

    stage.style.cursor =
      tools.map((each) => each.cursor(point)).find(Boolean) ?? "default";
    if (next !== hovered) {
      hovered = next;
      stage.title = next ? next.path || "the shown character" : "";
      render();
    }
  }
});

stage.addEventListener("mouseleave", () => {
  if (view.interact && hovered) {
    currentPlayer().hover(hovered, undefined);
  }
  hovered = undefined;
  if (state.movie) {
    render();
  }
});

stage.addEventListener("mousedown", (event) => {
  if (!state.movie) {
    return;
  }
  if (view.interact) {
    if (hovered) {
      pressed = hovered;
      currentPlayer().press(hovered);
      render();
    }
    return;
  }

  holder = tools.find((each) => each.down(pointAt(event), event));
  if (holder) {
    return;
  }

  // A click picks what the shown timeline places; a double click reaches inside
  const picked = instanceAt(pointAt(event), event.detail >= 2);

  state.inspected = picked?.path;
  onInspect();
  render();
});

window.addEventListener("mouseup", () => {
  holder?.up();
  holder = undefined;
  if (view.interact && pressed) {
    currentPlayer().release(pressed, pressed === hovered);
    pressed = undefined;
    render();
  }
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

export const play = (playing: boolean): void => {
  view.playing = playing;
  owed = 0;
  byId("play").textContent = playing ? "⏸" : "▶";
  showMode();
  if (playing) {
    requestAnimationFrame(loop);
  }
};
