/** Asks the page for one frame of the video, drawn at the given size */
export interface FrameRequest {
  kind: 'frame';
  index: number;
  time: number;
  width: number;
  height: number;
}

export type ToVideoPage = FrameRequest;

export type FromVideoPage =
  | { kind: 'meta'; width: number; height: number; duration: number }
  | { kind: 'error'; message: string }
  | { kind: 'frame'; index: number; data: Uint8Array };
