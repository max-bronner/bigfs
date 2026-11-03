import type { W3dAnimation } from '../../../formats/w3d/w3dAnimation';

type ClipClock = Pick<W3dAnimation, 'frameCount' | 'frameRate'>;

/** Gets the frames one pass of a clip spans: its last frame is where it ends, not a frame it holds */
const getFrameSpan = ({ frameCount }: ClipClock) => Math.max(1, frameCount - 1);

/** Gets the seconds one pass of a clip takes */
export const getClipSeconds = (clip: ClipClock): number =>
  getFrameSpan(clip) / (clip.frameRate || 1);

/**
 * Gets the frame a clip stands at after `seconds` of playback, looping. The
 * exact end of a pass is the clip's last frame, so a playhead stopped at the
 * end does not jump back to the first.
 */
export const getClipFrame = (clip: ClipClock, seconds: number): number => {
  const span = getFrameSpan(clip);
  const frames = seconds * (clip.frameRate || 1);
  const frame = frames % span;

  return frames > 0 && frame === 0 ? span : frame;
};
