import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { ModelScene } from '../../formats/w3d/w3dScene';

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

export interface TextureMessage {
  kind: 'texture';
  format: string;
  hasAlpha: boolean;
  levels: { width: number; height: number; pixels: Uint8Array }[];
}

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

export interface CompressedAudioMessage {
  kind: 'compressedAudio';
  bytes: Uint8Array;
  mime: string;
  format: string;
}

export interface VideoMessage {
  kind: 'video';
  width: number;
  height: number;
  frameCount: number;
  framesPerSecond: number;
  hasAlpha: boolean;
}

/** What the page is sent to draw or play, then the answers to what it asks */
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

export type FromPreviewPage =
  | { kind: 'ready' }
  | { kind: 'reveal'; uri: string; line: number }
  | { kind: 'animation'; file: string }
  | { kind: 'videoFrame'; index: number };
