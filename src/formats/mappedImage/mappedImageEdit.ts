import { parseMappedImage } from './mappedImage';
import type { MappedImage, MappedRect } from './mappedImage';

/**
 * Finds a `MappedImage` block in INI text and rewrites its `Coords` line in
 * place, so an editor can move the rectangle without touching anything else
 * the block holds.
 */

const HEADER = /^\s*MappedImage\s+(\S+)/i;
const END = /^\s*End\b/i;
const COORDS_LINE = /^(\s*Coords\s*=\s*)([^;]*?)(\s*(?:;.*)?)$/i;
const TEXTURE_LINE = /^(\s*)Texture\s*=/i;

/** One change to the lines of a document: replace `start` to `end` of `line`, or add a line before it */
export interface LineEdit {
  line: number;
  start: number;
  end: number;
  text: string;
  /** Whether `text` is a new line, to be put before `line` rather than into it */
  insertsLine?: boolean;
}

/** A block read from text: the definition and the line of its `End` */
export interface MappedImageBlock {
  image: MappedImage;
  endLine: number;
}

/** Reads the `MappedImage` block whose header is at `header`, or nothing when that line is not one or the block never closes */
export const readMappedImageBlock = (
  lines: readonly string[],
  header: number,
): MappedImageBlock | undefined => {
  const name = HEADER.exec(lines[header] ?? '')?.[1];
  const endLine = lines.findIndex((line, at) => at > header && END.test(line));

  if (!name || endLine < 0) {
    return undefined;
  }

  return {
    image: parseMappedImage(name, lines.slice(header + 1, endLine)),
    endLine,
  };
};

/** Formats `Coords` as the INI writes it */
export const formatCoords = (rect: MappedRect): string =>
  `Left:${rect.left} Top:${rect.top} Right:${rect.right} Bottom:${rect.bottom}`;

/**
 * Computes the edit that makes the block at `header` read `rect` as its
 * `Coords`: the value is replaced and a trailing comment kept, and a block
 * without `Coords` gets a line before its `End`, indented like its `Texture`.
 */
export const getCoordsEdit = (
  lines: readonly string[],
  header: number,
  rect: MappedRect,
): LineEdit | undefined => {
  const block = readMappedImageBlock(lines, header);

  if (!block) {
    return undefined;
  }

  const value = formatCoords(rect);

  for (let at = header + 1; at < block.endLine; at++) {
    const match = COORDS_LINE.exec(lines[at]);

    if (match) {
      return {
        line: at,
        start: match[1].length,
        end: match[1].length + match[2].length,
        text: value,
      };
    }
  }

  const indent =
    lines
      .slice(header + 1, block.endLine)
      .map((line) => TEXTURE_LINE.exec(line)?.[1])
      .find((found) => found !== undefined) ?? '  ';

  return {
    line: block.endLine,
    start: 0,
    end: 0,
    text: `${indent}Coords = ${value}`,
    insertsLine: true,
  };
};
