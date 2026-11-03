/** Request for one frame of the video, drawn at the given size */
export interface FrameRequest {
  kind: 'frame';
  index: number;
  time: number;
  width: number;
  height: number;
}

/** Messages the extension sends to the frame reader's page */
export type ToVideoPage = FrameRequest;

/** Messages the frame reader's page sends back: the video's size and length, a failure, or one frame's RGBA pixels */
export type FromVideoPage =
  | { kind: 'meta'; width: number; height: number; duration: number }
  | { kind: 'error'; message: string }
  | { kind: 'frame'; index: number; data: Uint8Array };
