import type { Size } from './getFitScale';

/** The part of the texture's on-screen box that can be seen, in CSS pixels from its top left */
export interface VisibleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the overlay canvas sits over the texture and how many bitmap pixels it has */
export interface OverlayWindow extends VisibleBox {
  /** Bitmap pixels per CSS pixel */
  pixelRatio: number;
  bitmapWidth: number;
  bitmapHeight: number;
}

/** Longest side the overlay's bitmap gets; browsers refuse a canvas far above this */
export const MAX_BITMAP_SIDE = 8192;

/**
 * Computes the window of the texture the overlay canvas covers: only what is
 * on screen, so its bitmap does not grow with the zoom. A canvas as big as a
 * texture zoomed to 3000% passes what a browser can allocate, and its boxes
 * vanish.
 */
export const getOverlayWindow = (
  texture: Size,
  visible: VisibleBox,
  devicePixelRatio: number,
): OverlayWindow => {
  const pixelRatio = Math.max(
    1,
    Math.min(devicePixelRatio, MAX_BITMAP_SIDE / 4),
  );
  const room = MAX_BITMAP_SIDE / pixelRatio;
  const left = Math.min(Math.max(0, visible.left), texture.width);
  const top = Math.min(Math.max(0, visible.top), texture.height);
  const width = Math.min(room, Math.max(1, visible.width), texture.width - left);
  const height = Math.min(
    room,
    Math.max(1, visible.height),
    texture.height - top,
  );

  return {
    left,
    top,
    width,
    height,
    pixelRatio,
    bitmapWidth: Math.max(1, Math.ceil(width * pixelRatio)),
    bitmapHeight: Math.max(1, Math.ceil(height * pixelRatio)),
  };
};
