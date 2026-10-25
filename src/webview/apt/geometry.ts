import type { RuRun } from '../../formats/apt/aptGeometry';
import { vscode } from './details';
import { absoluteOf } from './edit';
import type { Instance } from './player';
import { apply, invert, multiply } from './scene';
import type { Affine } from './scene';
import {
  addTool,
  inspected,
  pixelSize,
  play,
  render,
  sceneLeaves,
  view,
} from './stage';
import { state } from './state';

/**
 * Geometry on the stage. With the wireframe on (W) the triangles and lines
 * of what is picked are drawn over it; for a shape of this movie its
 * vertices can be dragged. A vertex moves together with every vertex at
 * the same point, so the mesh stays joined, and the texture stays where it
 * is in shape space. Released, the shape's `.ru` is written with its new
 * bounds, as one undoable edit.
 */

const VERTEX = 4;

/** One coordinate pair inside a run: which run, which list, where in it */
interface VertexRef {
  run: number;
  list: 'triangles' | 'lines';
  index: number;
}

interface Drag {
  shape: Instance;
  refs: VertexRef[];
  /** The runs as they were, to restore if nothing moved */
  original: RuRun[];
  /** The shape's own space to the shown character's */
  matrix: Affine;
  moved: boolean;
}

let drag: Drag | undefined;

const cloneRuns = (runs: RuRun[]): RuRun[] => structuredClone(runs);

/** The picked instance, when it is a shape whose geometry this movie owns */
const editableShape = (): Instance | undefined => {
  const instance = inspected();

  return view.wireframe &&
    instance?.character?.type === 'shape' &&
    instance.movie === state.movie
    ? instance
    : undefined;
};

/** Every vertex of a shape, by the point it is at */
const vertices = (runs: RuRun[]): Map<string, VertexRef[]> => {
  const points = new Map<string, VertexRef[]>();

  runs.forEach((run, index) => {
    for (const list of ['triangles', 'lines'] as const) {
      for (let at = 0; at < run[list].length; at += 2) {
        const key = `${run[list][at]},${run[list][at + 1]}`;
        const refs = points.get(key) ?? [];

        refs.push({ run: index, list, index: at });
        points.set(key, refs);
      }
    }
  });
  return points;
};

/** The vertex under a point on the stage, with every vertex sharing it */
const vertexAt = (
  shape: Instance,
  point: [number, number],
): VertexRef[] | undefined => {
  const matrix = absoluteOf(shape);
  const reach = (VERTEX + 2) * pixelSize();

  for (const [key, refs] of vertices(shape.movie.shapes[shape.id] ?? [])) {
    const [x, y] = apply(
      matrix,
      key.split(',').map(Number) as [number, number],
    );

    if (Math.hypot(x - point[0], y - point[1]) <= reach) {
      return refs;
    }
  }
  return undefined;
};

/** The leaves under an instance, for drawing their wireframe */
const leavesOf = (instance: Instance) =>
  sceneLeaves().filter((leaf) => {
    for (let at: Instance | undefined = leaf.instance; at; at = at.parent) {
      if (at === instance) {
        return true;
      }
    }
    return false;
  });

addTool({
  down(point) {
    const shape = editableShape();
    const refs = shape && vertexAt(shape, point);

    if (!shape || !refs) {
      return false;
    }
    if (view.playing) {
      play(false);
    }
    drag = {
      shape,
      refs,
      original: cloneRuns(shape.movie.shapes[shape.id] ?? []),
      matrix: absoluteOf(shape),
      moved: false,
    };
    return true;
  },
  move(point) {
    if (!drag) {
      return false;
    }

    const [x, y] = apply(invert(drag.matrix), point);
    // A preview: the page's copy of the geometry follows the pointer
    const runs = (drag.shape.movie.shapes[drag.shape.id] = cloneRuns(
      drag.original,
    ));

    for (const ref of drag.refs) {
      runs[ref.run][ref.list][ref.index] = Math.round(x * 100) / 100;
      runs[ref.run][ref.list][ref.index + 1] = Math.round(y * 100) / 100;
    }
    drag.moved = true;
    render();
    return true;
  },
  up() {
    if (drag?.moved) {
      vscode.postMessage({
        kind: 'geometry',
        shape: drag.shape.id,
        runs: drag.shape.movie.shapes[drag.shape.id],
      });
    } else if (drag) {
      drag.shape.movie.shapes[drag.shape.id] = drag.original;
    }
    drag = undefined;
  },
  draw(ctx, pixel) {
    const instance = inspected();

    if (!view.wireframe || !instance) {
      return;
    }

    ctx.lineWidth = pixel;
    ctx.strokeStyle = 'rgba(0,255,140,0.9)';
    for (const leaf of leavesOf(instance)) {
      if (leaf.character?.type !== 'shape') {
        continue;
      }

      const m = leaf.matrix;

      ctx.beginPath();
      for (const run of leaf.movie.shapes[leaf.id] ?? []) {
        const t = run.triangles;

        for (let i = 0; i < t.length; i += 6) {
          ctx.moveTo(...apply(m, [t[i], t[i + 1]]));
          ctx.lineTo(...apply(m, [t[i + 2], t[i + 3]]));
          ctx.lineTo(...apply(m, [t[i + 4], t[i + 5]]));
          ctx.closePath();
        }
        for (let i = 0; i < run.lines.length; i += 4) {
          ctx.moveTo(...apply(m, [run.lines[i], run.lines[i + 1]]));
          ctx.lineTo(...apply(m, [run.lines[i + 2], run.lines[i + 3]]));
        }
      }
      ctx.stroke();
    }

    const shape = editableShape();

    if (shape) {
      const matrix = multiply(absoluteOf(shape), [1, 0, 0, 1, 0, 0]);

      ctx.fillStyle = 'white';
      for (const key of vertices(shape.movie.shapes[shape.id] ?? []).keys()) {
        const [x, y] = apply(
          matrix,
          key.split(',').map(Number) as [number, number],
        );

        ctx.fillRect(
          x - VERTEX * pixel,
          y - VERTEX * pixel,
          2 * VERTEX * pixel,
          2 * VERTEX * pixel,
        );
        ctx.strokeRect(
          x - VERTEX * pixel,
          y - VERTEX * pixel,
          2 * VERTEX * pixel,
          2 * VERTEX * pixel,
        );
      }
    }
  },
  cursor(point) {
    const shape = editableShape();

    return drag || (shape && vertexAt(shape, point)) ? 'crosshair' : undefined;
  },
});
