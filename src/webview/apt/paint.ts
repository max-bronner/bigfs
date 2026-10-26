import { UNRESOLVED, localBounds } from './scene';
import type { Leaf } from './scene';
import { state } from './state';

const rgba = ([r, g, b, a]: number[]) => `rgba(${r},${g},${b},${a / 255})`;

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
          ctx.fillStyle = rgba(style.color);
          ctx.fill(path);
        } else if (style.kind === 'texture') {
          const texture = state.textures.get(
            movie.imageTextures[style.character],
          );

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
            ctx.drawImage(texture, 0, 0);
          } else {
            ctx.fillStyle = 'rgba(255,0,255,0.35)';
            ctx.fill(path);
          }
          ctx.restore();
        } else {
          ctx.strokeStyle = rgba(style.color);
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
      const texture = state.textures.get(movie.imageTextures[leaf.id]);

      if (texture) {
        ctx.drawImage(texture, 0, 0);
      }
      break;
    }
    case 'editText': {
      const [left, top, right, bottom] = character.bounds;
      const color = character.color >>> 0;
      const x =
        character.alignment === 1
          ? right
          : character.alignment === 2
            ? (left + right) / 2
            : left;
      const text =
        leaf.text ??
        character.text ??
        (character.variable ? '{' + character.variable + '}' : '');

      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(120,160,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.fillStyle = rgba([
        (color >> 16) & 255,
        (color >> 8) & 255,
        color & 255,
        color >>> 24,
      ]);
      ctx.font = Math.max(1, character.fontHeight) + 'px sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign =
        character.alignment === 1
          ? 'right'
          : character.alignment === 2
            ? 'center'
            : 'left';
      String(text)
        .split('\n')
        .forEach((line, index) =>
          ctx.fillText(
            line,
            x,
            top + index * character.fontHeight * 1.15,
            right - left,
          ),
        );
      break;
    }
  }
};
