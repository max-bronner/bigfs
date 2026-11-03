import type {
  AnimationStep,
  CursorFrame,
  CursorParseOptions,
} from './cursorFrame';
import { parseAni } from './parseAni';
import { parseCur } from './parseCur';

/** A parsed cursor file: its images, and for an animation the steps that play them */
export interface ParsedCursorFile {
  frames: CursorFrame[];
  /** Present for an animated cursor only */
  steps?: AnimationStep[];
}

/** Parses a `.cur`, `.ico` or `.ani`, telling an animation by its RIFF signature */
export const parseCursorFile = (
  bytes: Uint8Array,
  options: CursorParseOptions = {},
): ParsedCursorFile =>
  String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    ? parseAni(bytes, options)
    : { frames: parseCur(bytes, options) };
