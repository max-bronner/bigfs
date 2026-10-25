import type { Rect } from '../../formats/apt/aptMovie';
import { byId } from './dom';
import type { PageMovie } from './protocol';
import { movie, state } from './state';
import { displayList, framesOf } from './timeline';

/** Nesting deeper than this is a loop in the data, not a real movie */
const MAX_DEPTH = 12;

type Affine = [number, number, number, number, number, number];

const stage = byId<HTMLCanvasElement>('stage');
const zoomSelect = byId<HTMLSelectElement>('zoom');

const rgba = ([r, g, b, a]: number[]) => `rgba(${r},${g},${b},${a / 255})`;

/** Draws a character into a 2D context at the current transform */
export const draw = (
  ctx: CanvasRenderingContext2D,
  source: PageMovie,
  id: number,
  depth: number,
  frame: number,
): void => {
  const character = source.characters[id];

  if (!character || depth > MAX_DEPTH) {
    return;
  }

  switch (character.type) {
    case 'shape': {
      for (const run of source.shapes[id] ?? []) {
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
            source.imageTextures[style.character],
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
    }
    case 'image': {
      const texture = state.textures.get(source.imageTextures[id]);

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
        character.text ??
        (character.variable ? '{' + character.variable + '}' : '');

      ctx.save();
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
      ctx.restore();
      break;
    }
    case 'button':
      for (const record of character.records) {
        if (!(record.flags & 1)) {
          continue;
        }
        ctx.save();
        ctx.transform(...record.matrix, ...record.translate);
        draw(ctx, source, record.character, depth + 1, 0);
        ctx.restore();
      }
      break;
    case 'sprite':
    case 'movie':
      for (const placement of displayList(
        framesOf(source, character),
        depth === 0 ? frame : 0,
      )) {
        ctx.save();
        ctx.transform(...placement.matrix, ...placement.translate);
        ctx.globalAlpha *= placement.alpha;
        draw(ctx, source, placement.character, depth + 1, 0);
        ctx.restore();
      }
      break;
    case 'placeholder': {
      const imported = source.imports.find((each) => each.character === id);

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,180,0,0.8)';
      ctx.strokeRect(0, 0, 64, 24);
      ctx.fillStyle = 'rgba(255,180,0,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText(imported ? imported.name : 'import', 4, 14, 56);
      ctx.restore();
      break;
    }
  }
};

/** A box around everything a character draws at a frame */
export const boundsOf = (
  source: PageMovie,
  id: number,
  frame: number,
): Rect => {
  const character = source.characters[id];

  if (character.type === 'movie') {
    return [0, 0, source.record.screenWidth, source.record.screenHeight];
  }
  if ('bounds' in character) {
    return character.bounds;
  }
  if (character.type === 'image') {
    const texture = state.textures.get(source.imageTextures[id]);

    return [0, 0, texture?.width ?? 64, texture?.height ?? 64];
  }

  const box: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (cid: number, m: Affine, depth: number, at: number) => {
    const c = source.characters[cid];

    if (!c || depth > MAX_DEPTH) {
      return;
    }

    const corner = (x: number, y: number) => {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];

      box[0] = Math.min(box[0], px);
      box[1] = Math.min(box[1], py);
      box[2] = Math.max(box[2], px);
      box[3] = Math.max(box[3], py);
    };

    if ('bounds' in c) {
      corner(c.bounds[0], c.bounds[1]);
      corner(c.bounds[2], c.bounds[3]);
      corner(c.bounds[0], c.bounds[3]);
      corner(c.bounds[2], c.bounds[1]);
      return;
    }

    const children =
      c.type === 'sprite' || c.type === 'movie'
        ? displayList(framesOf(source, c), depth === 0 ? at : 0)
        : [];

    for (const child of children) {
      const [a, b, cc, d] = child.matrix;
      const [tx, ty] = child.translate;

      visit(
        child.character,
        [
          m[0] * a + m[2] * b,
          m[1] * a + m[3] * b,
          m[0] * cc + m[2] * d,
          m[1] * cc + m[3] * d,
          m[0] * tx + m[2] * ty + m[4],
          m[1] * tx + m[3] * ty + m[5],
        ],
        depth + 1,
        0,
      );
    }
  };

  visit(id, [1, 0, 0, 1, 0, 0], 0, frame);
  return Number.isFinite(box[0]) ? box : [0, 0, 64, 64];
};

/** Draws the selected character at the shown frame, fitted or zoomed */
export const render = (): void => {
  const source = movie();
  const id = state.selected;
  const [left, top, right, bottom] = boundsOf(source, id, state.frame);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const zoom =
    zoomSelect.value === 'fit'
      ? Math.min(
          4,
          Math.max(
            0.05,
            Math.min(
              (stage.parentElement!.clientWidth - 24) / width,
              (window.innerHeight - 160) / height,
            ),
          ),
        )
      : Number(zoomSelect.value);
  const ratio = window.devicePixelRatio || 1;

  stage.width = Math.ceil((width + 16) * zoom * ratio);
  stage.height = Math.ceil((height + 16) * zoom * ratio);
  stage.style.width = stage.width / ratio + 'px';
  stage.style.height = stage.height / ratio + 'px';

  const ctx = stage.getContext('2d')!;

  ctx.setTransform(
    zoom * ratio,
    0,
    0,
    zoom * ratio,
    (8 - left) * zoom * ratio,
    (8 - top) * zoom * ratio,
  );
  ctx.clearRect(left - 8, top - 8, width + 16, height + 16);
  draw(ctx, source, id, 0, state.frame);
};
