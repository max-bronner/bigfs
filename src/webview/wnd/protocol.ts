import type { WndBox } from '../../formats/wnd/wndLayout';

/** One image of a layout: where its texture is, and how it maps */
export interface PreviewImage {
  texture: string;
  /** Left, top, width and height of the image in its texture, as fractions */
  uv: [number, number, number, number];
  rotated: boolean;
  /** Pixels it draws at, `Coords`' size swapped when rotated */
  extent: [number, number];
}

/** Message carrying the windows to draw, the images they name and the textures not yet sent */
export interface WndLayoutMessage {
  kind: 'layout';
  boxes: WndBox[];
  images: Record<string, PreviewImage>;
  /** Texture id to PNG data URI */
  textures: Record<string, string>;
}

/** Messages the extension sends to the WND preview's page */
export type ToWndPage = WndLayoutMessage;

/** Messages the WND preview's page sends: ready, or a window clicked, by its offset in the file */
export type FromWndPage =
  | { kind: 'ready' }
  | { kind: 'reveal'; offset: number };
