import {
  describeForeignClip,
  isOwnClip,
  poseAt,
} from '../../../formats/w3d/w3dPose';
import type { Pose, Vec3 } from '../../../formats/w3d/w3dPose';
import type { W3dAnimation } from '../../../formats/w3d/w3dAnimation';
import { isSurfaceAnimated } from '../../../formats/w3d/isSurfaceAnimated';
import type {
  SceneSkeleton,
  SubObjectRule,
} from '../../../formats/w3d/w3dScene';
import { element } from '../element';
import { createModelRenderer } from '../modelRenderer';
import { createOrbit } from '../orbit';
import type { Orbit } from '../orbit';
import type { CameraBasis } from '../orbitBasis';
import { buildGridLines } from './buildGridLines';
import { getClipFrame, getClipSeconds } from './clipTiming';
import { createClipPicker } from './createClipPicker';
import type { ClipList } from './createClipPicker';
import { createLineRenderer } from './createLineRenderer';
import type { DrawLines } from './createLineRenderer';
import { createPartsPanel } from './createPartsPanel';
import { createTransport } from './createTransport';
import { createViewControls } from './createViewControls';
import { describeDetailLevels, describeModel } from './describeModel';
import type { ViewerModel } from './describeModel';
import { adoptViewerStyle } from './viewerStyle';

/**
 * The one 3D viewer every model and effect preview runs on: the canvas and
 * its render loop, the orbit camera, the grid, and the controls every page
 * has in the same place. A plain model needs nothing more; a preview with
 * more to show adds a `ViewerLayer` for what runs on the clock and puts its
 * panels in `side`.
 */

/** Where one frame is seen from */
export interface ViewerCamera {
  basis: CameraBasis;
  matrix: Float32Array;
}

/** What a layer changes about a frame before it is drawn */
export interface FrameAdjustment {
  /** Radians the view shakes by */
  shake?: number;
  /** Where the model stands */
  modelOffset?: Vec3;
}

/** A context's part in the viewer: everything optional, called from the one render loop */
export interface ViewerLayer {
  /** Seconds the layer runs for, which the time slider spans with the clip */
  getLength?(): number;
  /** Whether the layer is still running past its length, which holds the loop back */
  isBusy?(): boolean;
  /** The playhead moved on to `time` by playing */
  onAdvance?(time: number): void;
  /** The playhead was dragged to `time` */
  onSeek?(time: number): void;
  /** The playhead went back to the start */
  onRestart?(): void;
  /** Runs on every animation frame, with or without WebGL */
  onFrame?(now: number): void;
  prepareFrame?(): FrameAdjustment;
  /** Draws over the grid and the model */
  draw?(camera: ViewerCamera): void;
  /** Handles a key the viewer does not use; true when it was used */
  onKey?(key: string): boolean;
}

/** A clip to play, with what is needed to tell whether it fits the model */
export interface ViewerClip {
  /** The choice in the animation list it stands for */
  id: string;
  animation: W3dAnimation;
  /** The skeleton the clip names, when it was found */
  skeleton?: SceneSkeleton;
}

/** What a page sets up a viewer with */
export interface ViewerOptions {
  /** Asks for a clip of the animation list; the page answers with `playClip` */
  onPickClip(id: string): void;
  /** Says under the parts what a model on its own cannot know */
  partsHint?: string;
  /** Where the camera looks until there is something to frame */
  target?: Vec3;
  radius?: number;
}

/** A running viewer, which pages drive and extend */
export interface Viewer {
  canvas: HTMLCanvasElement;
  /** Undefined when this machine has no WebGL or it failed; everything else still works */
  gl: WebGLRenderingContext | undefined;
  /** Sits over the canvas, for a context's overlays */
  stage: HTMLElement;
  /** The panel beside the canvas, for a context's panels */
  side: HTMLElement;
  orbit: Orbit;
  drawLines: DrawLines;
  addLayer(layer: ViewerLayer): void;
  /** Shows a model, or none; a clip playing carries over to it */
  setModel(model: ViewerModel | undefined): void;
  getModel(): ViewerModel | undefined;
  /** Gets the pose of the model now, when it has a skeleton */
  getPose(): Pose | undefined;
  setClips(list: ClipList): void;
  /** Plays a clip from the start, saying so when it was made for another skeleton */
  playClip(clip: ViewerClip): void;
  /** Goes back to the bind pose, with a line saying why when there is one */
  clearClip(notice?: string): void;
  /** Shows a choice as picked in the animation list while its clip is loading */
  showClipChoice(id: string | undefined): void;
  /** Takes what hides parts of the model beyond its file's own flags */
  setSubObjectRules(rules: SubObjectRule[]): void;
  /** Starts everything over from time 0 */
  restart(): void;
  getTime(): number;
  isPlaying(): boolean;
  /** Shows a short message in the status line */
  showStatus(text: string): void;
  /** Gets where the frame is seen from now */
  getCamera(): ViewerCamera;
}

const DEFAULT_TARGET: Vec3 = [0, 0, 20];
const DEFAULT_RADIUS = 85;
const CONTROLS_HELP =
  'drag to orbit, right-drag to pan, scroll to zoom, double-click to reset, B for bones';
/** Longest frame the clock takes, so a page that was away does not leap */
const MAX_FRAME_SECONDS = 0.25;

const getBoundsSphere = ({ bounds }: ViewerModel): [Vec3, number] => [
  [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as Vec3,
  Math.max(
    1e-3,
    Math.hypot(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis])) / 2,
  ),
];

const openContext = (canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ?? undefined;

  try {
    return gl && { gl, renderer: createModelRenderer(gl), drawLines: createLineRenderer(gl) };
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

/** Creates the viewer inside `root`, which it fills */
export const createViewer = (
  root: HTMLElement,
  { onPickClip, partsHint, target = DEFAULT_TARGET, radius = DEFAULT_RADIUS }: ViewerOptions,
): Viewer => {
  adoptViewerStyle();

  const layers: ViewerLayer[] = [];
  const canvas = element('canvas', undefined, 'viewer-canvas');
  const stage = element('div', undefined, 'viewer-stage');
  const side = element('div', undefined, 'viewer-side');
  const main = element('div', undefined, 'viewer-main');
  const transportBar = element('div', undefined, 'viewer-bar');
  const viewBar = element('div', undefined, 'viewer-bar');
  const status = element('span', undefined, 'viewer-status');
  const facts = element('p');
  const clipNotice = element('p');
  const levelFacts = element('p');
  const help = element('p', CONTROLS_HELP);
  const graphics = openContext(canvas);
  const orbit = createOrbit(canvas, target, radius, () => invalidate());

  let model: ViewerModel | undefined;
  let clip: ViewerClip | undefined;
  let pose: Pose | undefined;
  let rules: SubObjectRule[] = [];
  let animatesMaterials = false;
  let isFramed = false;
  let needsDraw = true;
  let grid = buildGridLines(0);
  let lastFrame = performance.now();

  const invalidate = () => {
    needsDraw = true;
  };
  const showStatus = (text: string) => {
    status.textContent = text;
  };

  const applyTime = () => {
    const skeleton = model?.skeleton;
    const frame = clip ? getClipFrame(clip.animation, transport.getTime()) : 0;

    pose = skeleton && poseAt(skeleton, clip?.animation, frame);
    if (skeleton) {
      graphics?.renderer.setPose(pose);
    }
    if (clip) {
      const { name, frameCount, frameRate } = clip.animation;

      showStatus(`${name} · frame ${frame.toFixed(1)} / ${frameCount} · ${frameRate} fps`);
    }
    invalidate();
  };

  const transport = createTransport({
    getLength: () =>
      Math.max(
        clip ? getClipSeconds(clip.animation) : 0,
        ...layers.map((layer) => layer.getLength?.() ?? 0),
      ),
    isBusy: () => layers.some((layer) => layer.isBusy?.()),
    canPlay: () => !!clip || animatesMaterials || layers.length > 0,
    onAdvance: (time) => {
      applyTime();
      layers.forEach((layer) => layer.onAdvance?.(time));
    },
    onSeek: (time) => {
      applyTime();
      layers.forEach((layer) => layer.onSeek?.(time));
    },
    onRestart: () => {
      applyTime();
      layers.forEach((layer) => layer.onRestart?.());
    },
  });
  const picker = createClipPicker((id) => {
    if (!id) {
      clearClip();
      return;
    }
    showStatus(`Loading ${id}…`);
    onPickClip(id);
  });
  const view = createViewControls((text) => {
    showStatus(text);
    parts.refresh();
    invalidate();
  });
  const parts = createPartsPanel(view.choices, () => rules, partsHint, invalidate);

  const describeClipFit = () =>
    clip && model?.skeleton && !isOwnClip(model.skeleton, clip.animation, clip.skeleton)
      ? describeForeignClip(clip.animation)
      : '';

  const clearClip = (notice = '') => {
    clip = undefined;
    picker.show(undefined);
    clipNotice.textContent = notice;
    showStatus('');
    transport.restart();
  };

  const getCamera = (shake?: number): ViewerCamera => {
    const basis = orbit.getBasis(shake);

    return {
      basis,
      matrix: orbit.getViewProjection(basis, canvas.width / Math.max(1, canvas.height)),
    };
  };

  const fitCanvas = (gl: WebGLRenderingContext) => {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  };

  const draw = () => {
    if (!graphics) {
      return;
    }

    const { gl, renderer, drawLines } = graphics;
    const { choices } = view;
    const sky = choices.sky;
    const adjustments = layers.map((layer) => layer.prepareFrame?.() ?? {});
    const shake = adjustments.reduce((total, each) => total + (each.shake ?? 0), 0);
    const offset = adjustments.find((each) => each.modelOffset)?.modelOffset;

    fitCanvas(gl);
    gl.clearColor(
      parseInt(sky.slice(1, 3), 16) / 255,
      parseInt(sky.slice(3, 5), 16) / 255,
      parseInt(sky.slice(5, 7), 16) / 255,
      1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const camera = getCamera(shake);
    const { basis, matrix } = camera;

    if (choices.showGrid) {
      drawLines(grid, matrix, true);
    }
    renderer.draw(matrix, {
      offset,
      light: basis.forward.map((axis) => -axis) as Vec3,
      showBones: choices.showBones,
      showMeshes: choices.showMeshes,
      lod: choices.lod,
      showHidden: choices.showHidden,
      subObjectRules: rules,
      partOverrides: parts.overrides,
      showBoxes: choices.showBoxes,
      seconds: transport.getMaterialSeconds(),
      camera: {
        eye: basis.eye,
        // prettier-ignore
        rotation: [
          basis.right[0], basis.up[0], -basis.forward[0],
          basis.right[1], basis.up[1], -basis.forward[1],
          basis.right[2], basis.up[2], -basis.forward[2],
        ],
      },
    });
    layers.forEach((layer) => layer.draw?.(camera));
  };

  const hasResized = () => {
    const ratio = window.devicePixelRatio || 1;

    return (
      canvas.width !== Math.round(canvas.clientWidth * ratio) ||
      canvas.height !== Math.round(canvas.clientHeight * ratio)
    );
  };

  const runFrame = (now: number) => {
    if (!canvas.isConnected) {
      return;
    }

    const seconds = Math.min(MAX_FRAME_SECONDS, (now - lastFrame) / 1000);

    lastFrame = now;
    if (transport.isPlaying()) {
      transport.advance(Math.max(0, seconds));
    }
    layers.forEach((layer) => layer.onFrame?.(now));
    if (needsDraw || layers.length || transport.isPlaying() || hasResized()) {
      needsDraw = false;
      draw();
    }
    requestAnimationFrame(runFrame);
  };

  const setModel = (next: ViewerModel | undefined) => {
    model = next;
    graphics?.renderer.setModel(next);
    animatesMaterials = !!next?.meshes.some((mesh) =>
      mesh.draws?.some((each) => isSurfaceAnimated(each.surface)),
    );
    view.setModel(next, rules);
    parts.setModel(next);
    picker.setHasSkeleton(!!next?.skeleton);
    facts.textContent = next ? describeModel(next) : '';
    levelFacts.textContent = next ? describeDetailLevels(next) : '';
    if (clip) {
      clipNotice.textContent = describeClipFit();
    }
    if (next) {
      const [centre, size] = getBoundsSphere(next);

      grid = buildGridLines(size);
      if (!isFramed) {
        isFramed = true;
        orbit.frame(centre, size);
      }
    }
    applyTime();
    transport.refresh();
  };

  window.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === ' ') {
      event.preventDefault();
      transport.togglePlaying();
    } else if (key === 'r') {
      transport.restart();
    } else if (key === '.') {
      transport.step();
    } else if (key === 'b') {
      if (model?.skeleton) {
        view.toggleBones();
      }
    } else {
      layers.some((layer) => layer.onKey?.(key));
    }
  });

  transportBar.append(picker.select, ...transport.controls);
  viewBar.append(...view.controls, status);
  main.append(transportBar, viewBar, stage);
  stage.append(canvas);
  side.append(clipNotice, facts, levelFacts, parts.panel, help);
  root.classList.add('viewer');
  root.replaceChildren(main, side);
  if (!graphics) {
    showStatus('This view needs WebGL, which is not available here.');
  }
  view.setModel(undefined, rules);
  transport.refresh();
  requestAnimationFrame(runFrame);

  return {
    canvas,
    gl: graphics?.gl,
    stage,
    side,
    orbit,
    drawLines: (lines, matrix, depthTest) => graphics?.drawLines(lines, matrix, depthTest),
    addLayer: (layer) => {
      layers.push(layer);
      transport.refresh();
    },
    setModel,
    getModel: () => model,
    getPose: () => pose,
    setClips: (list) => picker.setList(list),
    playClip: (next) => {
      clip = next;
      picker.show(next.id);
      clipNotice.textContent = describeClipFit();
      transport.restart();
      transport.setPlaying(true);
    },
    clearClip,
    showClipChoice: (id) => picker.show(id),
    setSubObjectRules: (next) => {
      rules = next;
      view.setModel(model, rules);
      parts.refresh();
      invalidate();
    },
    restart: () => transport.restart(),
    getTime: () => transport.getTime(),
    isPlaying: () => transport.isPlaying(),
    showStatus,
    getCamera: () => getCamera(),
  };
};
