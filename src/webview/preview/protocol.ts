import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { ModelScene } from '../../formats/w3d/w3dScene';

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

/** Message carrying a sound in a format the browser decodes itself */
export interface CompressedAudioMessage {
  kind: 'compressedAudio';
  bytes: Uint8Array;
  mime: string;
  format: string;
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

/** Messages the extension sends the preview page: what to draw or play, then the answers to what it asks */
export type ToPreviewPage =
  | TextureMessage
  | AudioMessage
  | CompressedAudioMessage
  | VideoMessage
  | ({ kind: 'model' } & ModelMessage)
  | { kind: 'error'; message: string }
  | { kind: 'animations'; names: string[] }
  | { kind: 'uses'; uses: FileUse[] }
  | { kind: 'animation'; file: string; animation: W3dAnimation }
  | { kind: 'animationError'; message: string }
  | { kind: 'videoFrame'; index: number; pixels: Uint8Array }
  | { kind: 'videoError'; message: string };

/** Messages the preview page sends: ready, a link followed, an animation or a movie frame asked for */
export type FromPreviewPage =
  | { kind: 'ready' }
  | { kind: 'reveal'; uri: string; line: number }
  | { kind: 'animation'; file: string }
  | { kind: 'videoFrame'; index: number };
