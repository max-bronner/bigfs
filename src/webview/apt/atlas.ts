import { fitRunTo, runBounds } from '../../formats/apt/aptGeometry';
import type { RuRun } from '../../formats/apt/aptGeometry';
import type { Character } from '../../formats/apt/aptMovie';
import { vscode } from './details';
import { button, byId, heading, row } from './dom';
import type { PageMovie } from './protocol';
import { resolve } from './resolve';
import { apply, textureOf } from './scene';
import type { Affine } from './scene';
import { inspected, render } from './stage';
import { movie, state } from './state';

/**
 * The texture behind a shape or image, whole: the region the shape samples
 * is bright, the rest of the atlas dimmed, with the triangles as they land
 * on it. For a shape of this movie the region can be dragged to move the
 * mapping or scaled by its corners, the image can be swapped for any image
 * of the movie (the mapping refitted to it), fitted again, or a new image
 * file imported; each is written to the shape's `.ru` as one edit, and an
 * import adds the Image, its `.dat` line and its texture file with it.
 */

const panel = byId('atlas');
const HANDLE = 5;
const WIDTH = 360;

interface Target {
  movie: PageMovie;
  id: number;
  character: Character;
}

interface Drag {
  run: number;
  mode: 'move' | { anchor: [number, number]; handle: [number, number] };
  start: [number, number];
  transform: Affine;
  original: RuRun[];
  moved: boolean;
}

let shownRun = 0;
let drag: Drag | undefined;
let canvas: HTMLCanvasElement | undefined;
let scale = 1;

/** The shape or image the atlas shows: the picked instance, else the selected character */
const target = (): Target | undefined => {
  const instance = inspected();
  const picked = instance?.character && {
    movie: instance.movie,
    id: instance.id,
    character: instance.character,
  };
  const listed = state.movie && {
    movie: movie(),
    id: state.selected,
    character: movie().characters[state.selected],
  };

  return [picked, listed].find(
    (each) => each && ['shape', 'image'].includes(each.character?.type),
  ) as Target | undefined;
};

const runsOf = (shape: Target): RuRun[] => shape.movie.shapes[shape.id] ?? [];

/** The box of an image the `.dat` says is used: a standalone rect, or the whole page */
const regionOf = (
  source: PageMovie,
  image: number,
): [number, number, number, number] => {
  const found = resolve(source, image);
  const location = found?.movie.imageLocations[found.id];
  const texture = textureOf(source, image);

  return location?.kind === 'standalone'
    ? location.rect
    : [0, 0, texture?.width ?? 1, texture?.height ?? 1];
};

const send = (shape: Target, runs: RuRun[]) =>
  vscode.postMessage({ kind: 'geometry', shape: shape.id, runs });

/** A run laid over an image's used box */
const retexture = (source: PageMovie, run: RuRun, image: number): RuRun =>
  fitRunTo(run, image, regionOf(source, image));

const draw = (shape: Target) => {
  if (!canvas) {
    return;
  }

  const runs = runsOf(shape);
  const run = runs[shownRun];
  const image =
    shape.character.type === 'image'
      ? shape.id
      : run?.style.kind === 'texture'
        ? run.style.character
        : undefined;
  const texture =
    image === undefined
      ? undefined
      : textureOf(shape.movie, image);
  const ctx = canvas.getContext('2d')!;

  if (!texture) {
    canvas.width = WIDTH;
    canvas.height = 40;
    ctx.fillStyle = 'gray';
    ctx.fillText(
      image === undefined
        ? 'a solid fill: pick an image to texture it'
        : 'texture not found',
      8,
      24,
    );
    return;
  }

  scale = Math.min(4, WIDTH / Math.max(texture.width, texture.height));
  canvas.width = Math.ceil(texture.width * scale);
  canvas.height = Math.ceil(texture.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(texture, 0, 0);

  // Everything but the region used, dimmed
  const region = new Path2D();

  region.rect(0, 0, texture.width, texture.height);
  if (shape.character.type === 'image') {
    const [l, t, r, b] = regionOf(shape.movie, shape.id);

    region.rect(l, t, r - l, b - t);
  } else if (run?.style.kind === 'texture') {
    const m = run.style.transform;
    const tri = run.triangles;

    for (let i = 0; i < tri.length; i += 6) {
      region.moveTo(...apply(m, [tri[i], tri[i + 1]]));
      region.lineTo(...apply(m, [tri[i + 2], tri[i + 3]]));
      region.lineTo(...apply(m, [tri[i + 4], tri[i + 5]]));
      region.closePath();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fill(region, 'evenodd');

  if (run?.style.kind === 'texture' && shape.character.type === 'shape') {
    const m = run.style.transform;
    const tri = run.triangles;

    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = 'rgba(0,255,140,0.95)';
    ctx.beginPath();
    for (let i = 0; i < tri.length; i += 6) {
      ctx.moveTo(...apply(m, [tri[i], tri[i + 1]]));
      ctx.lineTo(...apply(m, [tri[i + 2], tri[i + 3]]));
      ctx.lineTo(...apply(m, [tri[i + 4], tri[i + 5]]));
      ctx.closePath();
    }
    ctx.stroke();

    if (shape.movie === state.movie) {
      const [l, t, r, b] = mappedBox(run);

      ctx.strokeStyle = 'rgba(30,140,255,1)';
      ctx.strokeRect(l, t, r - l, b - t);
      ctx.fillStyle = 'white';
      for (const [x, y] of corners([l, t, r, b])) {
        ctx.fillRect(
          x - HANDLE / scale,
          y - HANDLE / scale,
          (2 * HANDLE) / scale,
          (2 * HANDLE) / scale,
        );
        ctx.strokeRect(
          x - HANDLE / scale,
          y - HANDLE / scale,
          (2 * HANDLE) / scale,
          (2 * HANDLE) / scale,
        );
      }
    }
  }
};

/** Where a run's points land on its texture, as a box */
const mappedBox = (run: RuRun): [number, number, number, number] => {
  const m = (run.style as Extract<RuRun['style'], { kind: 'texture' }>)
    .transform;
  const [l, t, r, b] = runBounds([run]) ?? [0, 0, 0, 0];
  const points = [
    apply(m, [l, t]),
    apply(m, [r, t]),
    apply(m, [r, b]),
    apply(m, [l, b]),
  ];

  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
};

const corners = ([l, t, r, b]: [number, number, number, number]) =>
  [
    [l, t],
    [r, t],
    [r, b],
    [l, b],
  ] as [number, number][];

const pointOn = (event: MouseEvent): [number, number] => [
  event.offsetX / scale,
  event.offsetY / scale,
];

const pressAt = (shape: Target, point: [number, number]): Drag | undefined => {
  const run = runsOf(shape)[shownRun];

  if (shape.movie !== state.movie || run?.style.kind !== 'texture') {
    return undefined;
  }

  const box = mappedBox(run);
  const handles = corners(box);
  const near = handles.findIndex(
    ([x, y]) => Math.hypot(x - point[0], y - point[1]) <= (HANDLE + 2) / scale,
  );
  const base = {
    run: shownRun,
    start: point,
    transform: [...run.style.transform] as Affine,
    original: structuredClone(runsOf(shape)),
    moved: false,
  };

  if (near >= 0) {
    return {
      ...base,
      mode: { anchor: handles[(near + 2) % 4], handle: handles[near] },
    };
  }
  return point[0] >= box[0] &&
    point[0] <= box[2] &&
    point[1] >= box[1] &&
    point[1] <= box[3]
    ? { ...base, mode: 'move' }
    : undefined;
};

const dragTo = (shape: Target, point: [number, number], uniform: boolean) => {
  const { mode, start, transform, original } = drag!;
  const [a, b, c, d, e, f] = transform;
  let next: Affine;

  if (mode === 'move') {
    next = [a, b, c, d, e + point[0] - start[0], f + point[1] - start[1]];
  } else {
    const [ax, ay] = mode.anchor;
    const [hx, hy] = mode.handle;
    let sx = (point[0] - ax) / (hx - ax || 1);
    let sy = (point[1] - ay) / (hy - ay || 1);

    if (uniform) {
      sx = sy = Math.max(Math.abs(sx), Math.abs(sy));
    }
    // Scaled about the opposite corner, in the texture's pixels
    next = [
      sx * a,
      sy * b,
      sx * c,
      sy * d,
      sx * (e - ax) + ax,
      sy * (f - ay) + ay,
    ];
  }

  const runs = structuredClone(original);
  const style = runs[drag!.run].style;

  if (style.kind === 'texture') {
    style.transform = next;
  }
  shape.movie.shapes[shape.id] = runs;
  drag!.moved = true;
  draw(shape);
  render();
};

/** Reads an image file the page was given into pixels */
const readImage = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  const scratch = document.createElement('canvas');

  scratch.width = bitmap.width;
  scratch.height = bitmap.height;

  const ctx = scratch.getContext('2d')!;

  ctx.drawImage(bitmap, 0, 0);
  return {
    width: bitmap.width,
    height: bitmap.height,
    pixels: new Uint8Array(
      ctx.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer,
    ),
  };
};

/** Fills the atlas panel for what is picked or selected, or empties it */
export const showAtlas = (): void => {
  const shape = target();

  canvas = undefined;
  if (!shape) {
    panel.replaceChildren();
    return;
  }

  const runs = runsOf(shape);
  const parts: HTMLElement[] = [heading('Texture')];
  const isOwn = shape.movie === state.movie;

  if (shape.character.type === 'shape') {
    shownRun = Math.min(shownRun, Math.max(0, runs.length - 1));

    const run = runs[shownRun];

    if (runs.length > 1) {
      const choose = document.createElement('select');

      runs.forEach((each, index) => {
        choose.add(
          new Option(
            `run ${index} · ${each.style.kind}`,
            String(index),
            false,
            index === shownRun,
          ),
        );
      });
      choose.onchange = () => {
        shownRun = Number(choose.value);
        showAtlas();
      };
      parts.push(row('Run', choose));
    }

    if (run && run.style.kind !== 'line' && isOwn) {
      const images = shape.movie.characters.filter(
        (each) => each.type === 'image',
      );
      const pick = document.createElement('select');
      const file = document.createElement('input');

      pick.add(new Option(run.style.kind === 'solid' ? 'solid fill' : '—', ''));
      for (const image of images) {
        const texture = state.textures.get(shape.movie.imageTextures[image.id]);
        const [l, t, r, b] = regionOf(shape.movie, image.id);

        pick.add(
          new Option(
            `#${image.id} · ${(shape.movie.imageTextures[image.id] ?? 'no texture').split('/').pop()} · ${r - l}×${b - t}` +
              (texture ? '' : ' (not found)'),
            String(image.id),
            false,
            run.style.kind === 'texture' && run.style.character === image.id,
          ),
        );
      }
      pick.onchange = () => {
        if (!pick.value) {
          return;
        }

        const next = structuredClone(runs);

        next[shownRun] = retexture(
          shape.movie,
          next[shownRun],
          Number(pick.value),
        );
        send(shape, next);
      };

      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
      file.hidden = true;
      file.onchange = async () => {
        const chosen = file.files?.[0];

        if (chosen) {
          const image = await readImage(chosen);

          vscode.postMessage({
            kind: 'importTexture',
            ...image,
            assign: {
              shape: shape.id,
              run: shownRun,
              runs: structuredClone(runs),
            },
          });
        }
      };

      parts.push(
        row('Image', pick),
        row(
          '',
          button('Fit to image', () => {
            if (run.style.kind === 'texture') {
              const next = structuredClone(runs);

              next[shownRun] = retexture(
                shape.movie,
                next[shownRun],
                run.style.character,
              );
              send(shape, next);
            }
          }),
          button('Import image…', () => file.click()),
          file,
        ),
      );
    } else if (!isOwn) {
      parts.push(
        row(
          '',
          document.createTextNode(`From ${shape.movie.name}: edit it there`),
        ),
      );
    }
  }

  canvas = document.createElement('canvas');
  canvas.className = 'atlas';
  canvas.onmousedown = (event) => {
    drag = pressAt(shape, pointOn(event));
  };
  canvas.onmousemove = (event) => {
    const point = pointOn(event);

    if (drag) {
      dragTo(shape, point, event.shiftKey);
    } else {
      const press = pressAt(shape, point);

      canvas!.style.cursor = !press
        ? 'default'
        : press.mode === 'move'
          ? 'move'
          : 'nwse-resize';
    }
  };
  parts.push(canvas);
  panel.replaceChildren(...parts);
  draw(shape);
};

window.addEventListener('mouseup', () => {
  const shape = target();

  if (drag?.moved && shape) {
    send(shape, runsOf(shape));
  }
  drag = undefined;
});
