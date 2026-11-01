import type { Rect } from '../../formats/apt/aptMovie';
import {
  advancePlayback,
  getRestingFrame,
  parsePlayback,
} from '../../formats/apt/aptView3d';
import { isSurfaceAnimated } from '../../formats/w3d/w3dMaterial';
import { poseAt } from '../../formats/w3d/w3dPose';
import { createModelRenderer } from '../shared/modelRenderer';
import type { ModelRenderer } from '../shared/modelRenderer';
import { getVsCodeApi } from '../shared/vscodeApi';
import { engine } from './engineState';
import { readBinding } from './gadgetModel';
import type { Gadget } from './gadgetModel';
import type { FromPage, ToPage } from './protocol';
import { createRenderObjectCache } from './renderObjectCache';
import type { RenderObject } from './renderObjectCache';
import type { SurfacePass } from './surfacePass';
import { paintPlaceholder } from './surfacePlaceholder';
import { findCameraBone, frameModel, lookThroughBone } from './view3dCamera';

const vscode = getVsCodeApi<FromPage>();

/**
 * `View3D` surfaces on the stage: the model a clip names, drawn off screen
 * through its own camera over a clear background and copied onto the stage
 * where the clip stands in paint order, so masks, fades and what is drawn
 * above it treat it like any other leaf. Ported from mint's `view3d.rs`:
 * white ambient light, and one animation clock per model, shared by the
 * surfaces showing it and released once a draw passes without one.
 */

/** Frames a second the player ticks at */
const TICKS_PER_SECOND = 30;
/** Longest side of a picture, in pixels */
const MAX_PICTURE_SIDE = 2048;

/** What a loaded model keeps for drawing */
interface Picture {
  renderer: ModelRenderer;
  canvas: HTMLCanvasElement;
  /** The frame and size `canvas` shows, and the time when a material moves with it */
  shows: string;
  /** Some material of the model moves with time, so a still picture is not enough */
  isAnimated: boolean;
}

let arrived: () => void = () => {};
let surface: { canvas: HTMLCanvasElement; gl: WebGLRenderingContext } | null | undefined;
const pictures = new Map<RenderObject, Picture>();
/** Renderers of models let go, each compiled once on the one context */
const idle: ModelRenderer[] = [];

const objects = createRenderObjectCache({
  ask: (name) => vscode.postMessage({ kind: 'renderObject', name }),
  release: (object) => {
    const picture = pictures.get(object);

    if (picture) {
      picture.renderer.setModel(undefined);
      idle.push(picture.renderer);
      pictures.delete(object);
    }
  },
});

/** Sets the callback run each time a model arrives */
export const onRenderObjects = (run: () => void): void => {
  arrived = run;
};

/** Takes the editor's answer about a model, then redraws */
export const renderObjectArrived = (
  data: Extract<ToPage, { kind: 'renderObject' }>,
): void => {
  if (data.scene) {
    objects.arrive(data.name, data.scene);
  } else {
    objects.fail(data.name, data.error ?? 'not found');
  }
  arrived();
};

/** Gets the one off-screen context every model draws on, or null without WebGL */
const getSurface = () => {
  if (surface === undefined) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true });

    surface = gl && { canvas, gl };
  }
  return surface;
};

const getPicture = (
  object: RenderObject,
  gl: WebGLRenderingContext,
): Picture => {
  let picture = pictures.get(object);

  if (!picture) {
    picture = {
      renderer: idle.pop() ?? createModelRenderer(gl),
      canvas: document.createElement('canvas'),
      shows: '',
      isAnimated: object.scene.meshes.some((mesh) =>
        mesh.draws?.some((draw) => isSurfaceAnimated(draw.surface)),
      ),
    };
    picture.renderer.setModel(object.scene);
    pictures.set(object, picture);
  }
  return picture;
};

/**
 * Moves a model's clock to this draw and gets the frame it shows. A model
 * first seen on a still stage shows where it comes to rest, its clock unmoved,
 * so playing runs its animation from the start.
 */
const advance = (
  object: RenderObject,
  gadget: Gadget,
  { player, pass, isPlaying }: SurfacePass,
): number => {
  const read = (name: string, fallback: string | number) =>
    readBinding(player, engine, gadget, { name, fallback });
  const playback = parsePlayback(read('_AnimMode', ''), read('_Frame', 0));
  const { animation } = object.scene;
  const released = object.pass < pass - 1 || player.ticks < object.tick;

  if (animation && pass !== object.pass) {
    const { frameRate, frameCount } = animation;

    if (released) {
      object.frame = 0;
    }
    object.isResting = !isPlaying && (released || object.isResting);
    if (isPlaying) {
      object.frame = advancePlayback(
        playback,
        object.frame,
        released ? 0 : (player.ticks - object.tick) / TICKS_PER_SECOND,
        frameRate,
        frameCount,
      );
    }
  }
  object.tick = player.ticks;
  object.pass = pass;
  return object.isResting && animation
    ? getRestingFrame(playback, object.frame, animation.frameCount)
    : object.frame;
};

/** Draws a model's picture at a size, unless it already shows that frame */
const drawPicture = (
  object: RenderObject,
  picture: Picture,
  frame: number,
  seconds: number,
  { canvas, gl }: NonNullable<ReturnType<typeof getSurface>>,
  width: number,
  height: number,
): void => {
  const shows = `${frame}:${width}x${height}${picture.isAnimated ? `@${seconds}` : ''}`;

  if (shows === picture.shows) {
    return;
  }
  canvas.width = picture.canvas.width = width;
  canvas.height = picture.canvas.height = height;
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const { skeleton, animation, bounds } = object.scene;
  const pose = skeleton && poseAt(skeleton, animation, frame);
  const bone = skeleton && pose?.world[findCameraBone(skeleton)];

  picture.renderer.setPose(pose);
  picture.renderer.draw(
    bone ? lookThroughBone(bone, width / height) : frameModel(bounds, width / height),
    { light: [0, 0, 1], unlit: true, showBones: false, seconds },
  );
  // Read back in this task: the context's buffer does not outlive it
  picture.canvas.getContext('2d')!.drawImage(canvas, 0, 0);
  picture.shows = shows;
};

/**
 * Paints a `View3D` surface in its box; the caller has set the transform,
 * alpha and masks. An empty `_RenderObj` shows nothing: the game fills it in
 * while playing, and a surface with no model of that name stays labelled.
 */
export const paintView3d = (
  ctx: CanvasRenderingContext2D,
  gadget: Gadget,
  box: Rect,
  pass: SurfacePass,
): void => {
  const name = String(
    readBinding(pass.player, engine, gadget, {
      name: '_RenderObj',
      fallback: '',
    }) ?? '',
  ).trim();

  if (!name) {
    return;
  }

  const state = objects.get(name, pass.pass);

  if (!('object' in state)) {
    paintPlaceholder(
      ctx,
      box,
      'pending' in state ? `[model ${name}…]` : `[no model ${name}: ${state.unavailable}]`,
    );
    return;
  }

  const shared = getSurface();

  if (!shared) {
    paintPlaceholder(ctx, box, `[model ${name}: no WebGL here]`);
    return;
  }

  const { object } = state;
  const frame = advance(object, gadget, pass);
  const { a, b, c, d } = ctx.getTransform();
  const [left, top, right, bottom] = box;
  const fit = (size: number) =>
    Math.max(1, Math.min(MAX_PICTURE_SIDE, Math.round(size)));
  const picture = getPicture(object, shared.gl);

  drawPicture(
    object,
    picture,
    frame,
    pass.player.ticks / TICKS_PER_SECOND,
    shared,
    fit(Math.hypot(a, b) * (right - left)),
    fit(Math.hypot(c, d) * (bottom - top)),
  );
  ctx.drawImage(picture.canvas, left, top, right - left, bottom - top);
};
