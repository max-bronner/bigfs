import type {
  AnimationStep,
  CursorFrame,
} from '../../formats/cursor/cursorFrame';
import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { ForeignClip } from '../../formats/w3d/w3dModelFinder';
import type { ModelScene, SceneSkeleton } from '../../formats/w3d/w3dScene';

/** Message carrying a W3D model, or the model an animation file is shown on */
export interface ModelMessage extends ModelScene {
  /** The model an animation file is shown on, found by its skeleton */
  shownOn?: string;
}

/** A line of an INI file that names the shown file */
export interface FileUse {
  uri: string;
  line: number;
  field: string;
  owner?: string;
}

/** Message carrying a texture's mip levels as RGBA pixels, finest first */
export interface TextureMessage {
  kind: 'texture';
  format: string;
  hasAlpha: boolean;
  levels: { width: number; height: number; pixels: Uint8Array }[];
}

/** A part of a texture something else uses, drawn as a box over it */
export interface TextureRegion {
  /** Names the region in the messages about it */
  id: string;
  label: string;
  /** What uses the region, to group the list */
  group: string;
  /** In pixels of the finest level: left, top, right, bottom */
  rect: [number, number, number, number];
  /** Whether the image is packed turned a quarter turn clockwise, so its box is the packed one */
  rotated: boolean;
  /** Whether dragging the box writes the change back */
  editable: boolean;
  /** Why it cannot be edited, or anything else worth showing next to it */
  note?: string;
  /** The text the region is defined in, to jump to */
  source?: { uri: string; line: number };
}

/** Message carrying the regions of the shown texture that other files use */
export interface RegionsMessage {
  kind: 'regions';
  regions: TextureRegion[];
  /** Whether the regions are added to those already shown instead of replacing them */
  append?: boolean;
  /** The region to show selected */
  selected?: string;
  /** Whether more regions are still being found */
  loading?: boolean;
}

/** Message carrying a sound decoded to WAV, with the facts of the original */
export interface AudioMessage {
  kind: 'audio';
  wav: Uint8Array;
  info: {
    format: string;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
    durationSeconds: number;
  };
}

/** Message opening a VP6 movie; its frames follow one by one as the page asks */
export interface VideoMessage {
  kind: 'video';
  width: number;
  height: number;
  frameCount: number;
  framesPerSecond: number;
  hasAlpha: boolean;
}

/** Message carrying a cursor file's images, with the steps that play them when it is animated */
export interface CursorMessage {
  kind: 'cursor';
  frames: CursorFrame[];
  steps?: AnimationStep[];
}

/** Messages the extension sends the preview page: what to draw or play, then the answers to what it asks */
export type ToPreviewPage =
  | TextureMessage
  | RegionsMessage
  | AudioMessage
  | VideoMessage
  | CursorMessage
  | ({ kind: 'model' } & ModelMessage)
  | { kind: 'error'; message: string }
  | { kind: 'animations'; own: string[]; foreign: ForeignClip[] }
  | { kind: 'uses'; uses: FileUse[] }
  | {
      kind: 'animation';
      file: string;
      animation: W3dAnimation;
      /** The skeleton the animation names, when it was found */
      skeleton?: SceneSkeleton;
    }
  | { kind: 'animationError'; message: string }
  | { kind: 'videoFrame'; index: number; pixels: Uint8Array }
  | { kind: 'videoError'; message: string };

/** Messages the preview page sends: ready, a link followed, a region edited, the editor popped out, an animation or a movie frame asked for */
export type FromPreviewPage =
  | { kind: 'ready' }
  | { kind: 'popOut' }
  | {
      kind: 'editRegion';
      id: string;
      rect: [number, number, number, number];
    }
  | { kind: 'reveal'; uri: string; line: number }
  | { kind: 'animation'; file: string }
  | { kind: 'videoFrame'; index: number };
