import type { CursorFrame } from '../../formats/cursor/cursorFrame';

/** An image offered to the animation builder, with the name of the file it came from */
export interface BuilderImage extends CursorFrame {
  name: string;
}

/** Messages the extension sends the animation builder's page */
export type ToBuilderPage =
  | { kind: 'images'; images: BuilderImage[] }
  | { kind: 'error'; message: string };

/** Messages the animation builder's page sends the extension */
export type FromBuilderPage =
  | { kind: 'ready' }
  | { kind: 'addImages' }
  /** The finished `.ani`, written by the page so it can refuse an animation it cannot store */
  | { kind: 'save'; bytes: Uint8Array };
