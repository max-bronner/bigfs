/** One cursor image: RGBA pixels top row first, and the pixel that points */
export interface CursorFrame {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  /** Four bytes a pixel in red, green, blue, alpha order */
  pixels: Uint8Array;
}

/** One step of an animated cursor: which frame is shown and for how long */
export interface AnimationStep {
  /** Index into the animation's frames */
  frame: number;
  /** Duration in jiffies, 1/60 s */
  jiffies: number;
}

/** An animated cursor: its distinct frames and the steps that play them */
export interface AnimatedCursor {
  frames: CursorFrame[];
  steps: AnimationStep[];
}

/** Decodes the PNG bytes of a PNG-compressed icon frame; the format module has no zlib */
export type PngDecoder = (bytes: Uint8Array) => {
  width: number;
  height: number;
  pixels: Uint8Array;
};

/** What the parsers need from their host */
export interface CursorParseOptions {
  /** Without it a PNG-compressed frame is an error */
  decodePng?: PngDecoder;
}
