import type { Character } from '../../formats/apt/aptMovie';
import { UNRESOLVED, localBounds, textureOf } from './scene';
import type { Leaf } from './scene';
import { isPlainColor, type ColorTransform } from './timeline';

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** A solid colour after the leaf's transform: `c * mult + add` per channel. Alpha rides on `globalAlpha` */
const rgba = ([r, g, b, a]: number[], color?: ColorTransform) => {
  const [mr, mg, mb] = color?.mult ?? [1, 1, 1];
  const [ar, ag, ab] = color?.add ?? [0, 0, 0];

  return `rgba(${clamp(r * mr + ar * 255)},${clamp(g * mg + ag * 255)},${clamp(b * mb + ab * 255)},${a / 255})`;
};

/** Texture copies already run through a colour transform, per texture */
const tints = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
const MAX_TINTS = 16;

/**
 * A texture drawn through a colour transform's red, green and blue terms,
 * on an offscreen canvas (alpha stays with the caller's `globalAlpha`)
 */
const tinted = (
  texture: HTMLCanvasElement,
  { mult, add }: ColorTransform,
): HTMLCanvasElement => {
  const key = [...mult.slice(0, 3), ...add.slice(0, 3)].join(',');
  let copies = tints.get(texture);
  const known = copies?.get(key);

  if (known) {
    return known;
  }

  const out = document.createElement('canvas');

  out.width = texture.width;
  out.height = texture.height;

  const ctx = out.getContext('2d')!;

  ctx.drawImage(texture, 0, 0);

  const image = ctx.getImageData(0, 0, out.width, out.height);
  const { data } = image;

  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      data[i + channel] = clamp(
        data[i + channel] * mult[channel] + add[channel] * 255,
      );
    }
  }
  ctx.putImageData(image, 0, 0);
  if (!copies) {
    copies = new Map();
    tints.set(texture, copies);
  }
  if (copies.size >= MAX_TINTS) {
    copies.clear();
  }
  copies.set(key, out);
  return out;
};

/** A leaf's texture, tinted when its colour transform asks */
const shown = (texture: HTMLCanvasElement, leaf: Leaf): HTMLCanvasElement =>
  isPlainColor(leaf.color) ? texture : tinted(texture, leaf.color);

/** Flash's `TextField` gutter: 2 units of padding inside the box on every side */
export const TEXT_GUTTER = 2;

/** The fonts the retail movies name, then the fallbacks to try after them */
const FONT_FALLBACKS = ['Albertus MT', 'Omnia LT Std'];

/** The CSS font stack of a text field: its own font by name, then the shipped ones */
export const fontStack = (name?: string): string =>
  [...new Set([...(name ? [name] : []), ...FONT_FALLBACKS])]
    .map((family) => `'${family.replace(/'/g, '')}'`)
    .concat('sans-serif')
    .join(', ');

/**
 * The text a field shows. The one place the string comes from, so that
 * resolving `$KEY` strings against a language can hook in here later.
 */
export const textOf = (
  leaf: Pick<Leaf, 'text'>,
  character: Extract<Character, { type: 'editText' }>,
): string =>
  leaf.text ??
  character.text ??
  (character.variable ? '{' + character.variable + '}' : '');

/** Breaks text at `\r`, `\r\n` and `\n`, then at spaces so no line is wider than `width` */
export const wrapLines = (
  text: string,
  width: number,
  measure: (line: string) => number,
): string[] =>
  text.split(/\r\n|\r|\n/).flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;

      if (!line || measure(next) <= width) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  });

/** One line of a laid-out field: where its left edge and its baseline go */
export interface TextLine {
  text: string;
  x: number;
  y: number;
}

/**
 * Lays a text field out as mint's apt-viewer does. A multiline field wraps
 * at its box less the gutter; with wordwrap it is anchored at the top
 * (baseline `top`), every other field is one run centred vertically
 * (baseline `middle`). Each line aligns by its own width.
 */
export const layoutText = (
  character: Extract<Character, { type: 'editText' }>,
  text: string,
  measure: (line: string) => number,
): { lines: TextLine[]; baseline: 'top' | 'middle' } => {
  const [boxLeft, top, boxRight, bottom] = character.bounds;
  const left = boxLeft + TEXT_GUTTER;
  const right = boxRight - TEXT_GUTTER;
  const lineHeight = character.fontHeight * 1.15;
  const fraction =
    character.alignment === 1 ? 1 : character.alignment === 2 ? 0.5 : 0;
  const texts = character.multiline
    ? wrapLines(text, right - left, measure)
    : [text];
  const anchoredTop = Boolean(character.multiline && character.wordwrap);
  const first = anchoredTop
    ? top + TEXT_GUTTER
    : (top + bottom) / 2 - ((texts.length - 1) * lineHeight) / 2;

  return {
    baseline: anchoredTop ? 'top' : 'middle',
    lines: texts.map((line, index) => ({
      text: line,
      x: left + (right - left - measure(line)) * fraction,
      y: first + index * lineHeight,
    })),
  };
};

/** The area one leaf covers, in its own space: its triangles, else its box */
const leafArea = (leaf: Leaf): Path2D => {
  const path = new Path2D();
  const runs =
    leaf.character?.type === 'shape' ? (leaf.movie.shapes[leaf.id] ?? []) : [];

  for (const run of runs) {
    for (let i = 0; i < run.triangles.length; i += 6) {
      path.moveTo(run.triangles[i], run.triangles[i + 1]);
      path.lineTo(run.triangles[i + 2], run.triangles[i + 3]);
      path.lineTo(run.triangles[i + 4], run.triangles[i + 5]);
      path.closePath();
    }
  }
  if (!runs.length) {
    const [left, top, right, bottom] = localBounds(leaf);

    path.rect(left, top, right - left, bottom - top);
  }
  return path;
};

const areas = new WeakMap<Leaf[], Path2D>();

/**
 * A mask's area in stage space, the union of what its leaves draw: a
 * mask's shapes count by where they are, not their colour or alpha
 */
export const maskArea = (mask: Leaf[]): Path2D => {
  let area = areas.get(mask);

  if (!area) {
    area = new Path2D();
    for (const leaf of mask) {
      const [a, b, c, d, e, f] = leaf.matrix;

      area.addPath(leafArea(leaf), new DOMMatrix([a, b, c, d, e, f]));
    }
    areas.set(mask, area);
  }
  return area;
};

/** Paints one leaf in its own space; the caller has set its transform and alpha */
export const paintLeaf = (ctx: CanvasRenderingContext2D, leaf: Leaf): void => {
  const { character, movie } = leaf;

  if (!character) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,80,0,0.9)';
    ctx.strokeRect(...UNRESOLVED);
    ctx.fillStyle = 'rgba(255,80,0,0.95)';
    ctx.font = '10px sans-serif';
    ctx.fillText(leaf.missing ?? 'import', 4, 14, 56);
    return;
  }

  switch (character.type) {
    case 'shape':
      for (const run of movie.shapes[leaf.id] ?? []) {
        const path = new Path2D();

        for (let i = 0; i < run.triangles.length; i += 6) {
          path.moveTo(run.triangles[i], run.triangles[i + 1]);
          path.lineTo(run.triangles[i + 2], run.triangles[i + 3]);
          path.lineTo(run.triangles[i + 4], run.triangles[i + 5]);
          path.closePath();
        }

        const { style } = run;

        if (style.kind === 'solid') {
          ctx.fillStyle = rgba(style.color, leaf.color);
          ctx.fill(path);
        } else if (style.kind === 'texture') {
          const texture = textureOf(movie, style.character);

          ctx.save();
          ctx.clip(path);
          if (texture) {
            const [m00, m01, m10, m11, tx, ty] = style.transform;
            const det = m00 * m11 - m01 * m10 || 1;

            // The style maps shape space to image pixels; drawing needs the inverse
            ctx.transform(
              m11 / det,
              -m01 / det,
              -m10 / det,
              m00 / det,
              (m10 * ty - m11 * tx) / det,
              (m01 * tx - m00 * ty) / det,
            );
            ctx.globalAlpha *= style.color[3] / 255;
            ctx.drawImage(shown(texture, leaf), 0, 0);
          } else {
            ctx.fillStyle = 'rgba(255,0,255,0.35)';
            ctx.fill(path);
          }
          ctx.restore();
        } else {
          ctx.strokeStyle = rgba(style.color, leaf.color);
          ctx.lineWidth = style.width || 1;
          ctx.beginPath();
          for (let i = 0; i < run.lines.length; i += 4) {
            ctx.moveTo(run.lines[i], run.lines[i + 1]);
            ctx.lineTo(run.lines[i + 2], run.lines[i + 3]);
          }
          ctx.stroke();
        }
      }
      break;
    case 'image': {
      const texture = textureOf(movie, leaf.id);

      if (texture) {
        ctx.drawImage(shown(texture, leaf), 0, 0);
      }
      break;
    }
    case 'editText': {
      const [left, top, right, bottom] = character.bounds;
      const color = character.color >>> 0;
      const font = movie.characters[character.font];

      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(120,160,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.fillStyle = rgba(
        [(color >> 16) & 255, (color >> 8) & 255, color & 255, color >>> 24],
        leaf.color,
      );
      ctx.font = `${Math.max(1, character.fontHeight)}px ${fontStack(font?.type === 'font' ? font.name : undefined)}`;
      ctx.textAlign = 'left';

      const { lines, baseline } = layoutText(
        character,
        textOf(leaf, character),
        (line) => ctx.measureText(line).width,
      );

      ctx.textBaseline = baseline;
      for (const line of lines) {
        ctx.fillText(line.text, line.x, line.y);
      }
      break;
    }
  }
};
