import { toNumberOr } from './aptGadgets';

/**
 * `_type = "View3D"` surfaces: a W3D render object drawn into a clip. The clip
 * names it in `_RenderObj` and says how its animation runs with `_AnimMode`
 * and `_Frame`, a literal 0-based frame of the model's own animation. Ported
 * from mint's `view3d.rs`.
 */

/** How a surface's model animates */
export type Playback =
  | { mode: 'hold' | 'playTo'; frame: number }
  | { mode: 'loop' };

/** Reads `_AnimMode` and `_Frame`; a mode nothing here knows holds, as mint's does */
export const parsePlayback = (mode: unknown, frame: unknown): Playback => {
  const name = String(mode ?? '').toUpperCase();

  return name === 'LOOP'
    ? { mode: 'loop' }
    : {
        mode: name === 'PLAY_TO_FRAME' ? 'playTo' : 'hold',
        frame: toNumberOr(frame, 0),
      };
};

/** Gets the frame `seconds` after `current`, playing an animation of `frames` frames at `rate` a second */
export const advancePlayback = (
  playback: Playback,
  current: number,
  seconds: number,
  rate: number,
  frames: number,
): number => {
  const last = Math.max(0, frames - 1);
  const step = Math.max(0, seconds * rate);

  if (playback.mode === 'loop') {
    return last > 0 ? (current + step) % (last + 1) : 0;
  }

  const target = Math.max(0, Math.min(last, playback.frame));

  if (playback.mode === 'hold') {
    return target;
  }
  return current < target
    ? Math.min(target, current + step)
    : Math.max(target, current - step);
};

/**
 * Gets the frame a still stage shows: a mode playing to a frame rests there,
 * since a model's first frames are often its empty start.
 */
export const getRestingFrame = (
  playback: Playback,
  current: number,
  frames: number,
): number =>
  playback.mode === 'loop'
    ? current
    : advancePlayback(playback, current, Infinity, 1, frames);

/**
 * Gets the file a `_RenderObj` names, or nothing for a name with folders in
 * it: a movie comes from a mod and names a model, never a place on disk.
 */
export const toRenderObjectFile = (name: string): string | undefined => {
  const stem = name.trim().replace(/\.w3d$/i, '');

  return stem && !/[\\/:]|\.\./.test(stem) ? `${stem}.w3d` : undefined;
};
