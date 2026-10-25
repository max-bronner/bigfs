import type { Matrix2, Rect } from '../../formats/apt/aptMovie';
import { send } from './details';
import type { Instance } from './player';
import {
  IDENTITY,
  apply,
  invert,
  localBounds,
  multiply,
  transformRect,
  union,
} from './scene';
import type { Affine } from './scene';
import {
  currentPlayer,
  inspected,
  instanceBox,
  pixelSize,
  play,
  render,
  sceneLeaves,
  addTool,
  stageExtent,
  view,
} from './stage';
import { state } from './state';

/**
 * Editing on the stage: the inspected instance gets a box with handles. Its
 * body moves it, corners and edges scale it about the opposite side, the
 * knob above rotates it about its registration point. Moving snaps to the
 * edges and centres of the instances beside it and of the screen (Alt
 * turns that off; Shift keeps to one axis, keeps proportions, or turns in
 * 15 degree steps). The change shows while dragging and is written once,
 * on release, to the PlaceObject that sets the instance's matrix at this
 * frame, as one undoable edit. Arrow keys nudge (Shift by 10).
 */

const HANDLE = 5;
const KNOB_OFFSET = 22;
const SNAP = 6;

type Mode =
  | { kind: 'move' }
  | {
      kind: 'scale';
      anchor: [number, number];
      handle: [number, number];
      axes: 'x' | 'y' | 'xy';
    }
  | { kind: 'rotate' };

interface Drag {
  instance: Instance;
  mode: Mode;
  start: [number, number];
  /** Its matrix in its parent when the drag began */
  placement: Affine;
  /** Its parent's matrix in the shown character's space */
  parent: Affine;
  /** Its box, and the lines it snaps to, when the drag began */
  box?: Rect;
  lines: { xs: number[]; ys: number[] };
  moved: boolean;
}

let drag: Drag | undefined;
let guides: { x?: number; y?: number } = {};

const placementOf = (instance: Instance): Affine => [
  ...instance.matrix,
  ...instance.translate,
];

/** Where an instance's own space sits in the shown character's */
export const absoluteOf = (instance: Instance): Affine => {
  let matrix = IDENTITY;

  for (let at: Instance | undefined = instance; at?.parent; at = at.parent) {
    matrix = multiply(placementOf(at), matrix);
  }
  return matrix;
};

/**
 * Whether moving an instance can be written: it sits in a timeline of the
 * movie being edited, placed by a record there. One drawn from an imported
 * movie is edited in that movie.
 */
/** Whether the box and handles show: a shape's vertices take over in wireframe */
const handlesShown = (instance: Instance | undefined): instance is Instance =>
  editable(instance) &&
  !(view.wireframe && instance.character?.type === 'shape');

export const editable = (
  instance: Instance | undefined,
): instance is Instance =>
  !!instance?.parent &&
  instance.parent.movie === state.movie &&
  ['sprite', 'movie'].includes(instance.parent.character?.type ?? '') &&
  instance.matrixItem !== undefined;

/** The box around what an instance draws, in its own space */
const ownBox = (instance: Instance): Rect | undefined => {
  const back = invert(absoluteOf(instance));

  return union(
    sceneLeaves()
      .filter((leaf) => {
        for (let at: Instance | undefined = leaf.instance; at; at = at.parent) {
          if (at === instance) {
            return true;
          }
        }
        return false;
      })
      .map((leaf) =>
        transformRect(multiply(back, leaf.matrix), localBounds(leaf)),
      ),
  );
};

/** The handles of a box in its own space: four corners, four edges */
const handlesOf = ([l, t, r, b]: Rect): {
  at: [number, number];
  mode: Mode;
}[] => {
  const mx = (l + r) / 2;
  const my = (t + b) / 2;
  const scale = (
    at: [number, number],
    anchor: [number, number],
    axes: 'x' | 'y' | 'xy',
  ) => ({ at, mode: { kind: 'scale' as const, anchor, handle: at, axes } });

  return [
    scale([l, t], [r, b], 'xy'),
    scale([r, t], [l, b], 'xy'),
    scale([r, b], [l, t], 'xy'),
    scale([l, b], [r, t], 'xy'),
    scale([mx, t], [mx, b], 'y'),
    scale([r, my], [l, my], 'x'),
    scale([mx, b], [mx, t], 'y'),
    scale([l, my], [r, my], 'x'),
  ];
};

/** The rotation knob: above the top edge, a fixed distance on screen */
const knobOf = (instance: Instance, box: Rect): [number, number] => {
  const matrix = absoluteOf(instance);
  const top = apply(matrix, [(box[0] + box[2]) / 2, box[1]]);
  const centre = apply(matrix, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  const length = Math.hypot(top[0] - centre[0], top[1] - centre[1]) || 1;
  const reach = KNOB_OFFSET * pixelSize();

  return [
    top[0] + ((top[0] - centre[0]) / length) * reach,
    top[1] + ((top[1] - centre[1]) / length) * reach,
  ];
};

const near = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= (HANDLE + 2) * pixelSize();

/** The mode a press at a point starts on the inspected instance, if any */
const modeAt = (point: [number, number]): Mode | undefined => {
  const instance = inspected();
  const box = instance && handlesShown(instance) ? ownBox(instance) : undefined;

  if (!instance || !box) {
    return undefined;
  }
  if (near(point, knobOf(instance, box))) {
    return { kind: 'rotate' };
  }

  const matrix = absoluteOf(instance);
  const handle = handlesOf(box).find((each) =>
    near(point, apply(matrix, each.at)),
  );

  if (handle) {
    return handle.mode;
  }

  const [x, y] = apply(invert(matrix), point);

  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
    ? { kind: 'move' }
    : undefined;
};

/** Edges and centres to snap to: the instance's siblings, and the screen */
const snapLines = (instance: Instance): { xs: number[]; ys: number[] } => {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = ([l, t, r, b]: Rect) => {
    xs.push(l, (l + r) / 2, r);
    ys.push(t, (t + b) / 2, b);
  };

  for (const sibling of instance.parent?.children.values() ?? []) {
    const box = sibling !== instance ? instanceBox(sibling) : undefined;

    if (box) {
      add(box);
    }
  }

  const root = currentPlayer().root;

  if (root.character?.type === 'movie') {
    add([0, 0, root.movie.record.screenWidth, root.movie.record.screenHeight]);
  }
  return { xs, ys };
};

/** The offset that brings a box's nearest edge or centre onto a line, per axis */
const snap = (box: Rect, lines: { xs: number[]; ys: number[] }) => {
  const reach = SNAP * pixelSize();
  const best = (own: number[], targets: number[]) => {
    let found: { by: number; at: number } | undefined;

    for (const value of own) {
      for (const target of targets) {
        const by = target - value;

        if (
          Math.abs(by) <= reach &&
          (!found || Math.abs(by) < Math.abs(found.by))
        ) {
          found = { by, at: target };
        }
      }
    }
    return found;
  };

  return {
    x: best([box[0], (box[0] + box[2]) / 2, box[2]], lines.xs),
    y: best([box[1], (box[1] + box[3]) / 2, box[3]], lines.ys),
  };
};

const setPlacement = (instance: Instance, matrix: Affine) => {
  instance.matrix = matrix.slice(0, 4) as Matrix2;
  instance.translate = [matrix[4], matrix[5]];
};

/** Writes an instance's placement where its matrix at this frame comes from */
export const commit = (instance: Instance, matrix: Affine): void => {
  send({
    kind: 'placement',
    offset: instance.matrixItem!,
    change: {
      matrix: matrix.slice(0, 4) as Matrix2,
      translate: [matrix[4], matrix[5]],
    },
  });
};

/** Moves an instance by an offset in its parent's space, now and in the file */
export const nudge = (dx: number, dy: number): boolean => {
  const instance = inspected();

  if (!editable(instance)) {
    return false;
  }

  const placement = placementOf(instance);

  commit(instance, [
    ...(placement.slice(0, 4) as Matrix2),
    placement[4] + dx,
    placement[5] + dy,
  ]);
  return true;
};

const update = (point: [number, number], event: MouseEvent) => {
  const { instance, mode, start, placement, parent } = drag!;
  const toParent = invert(parent);
  let next: Affine;

  guides = {};

  if (mode.kind === 'move') {
    // The offset in the shown character's space, where snapping is measured
    let dx = point[0] - start[0];
    let dy = point[1] - start[1];

    if (event.shiftKey) {
      // One axis: whichever the pointer has gone further along
      if (Math.abs(dx) > Math.abs(dy)) {
        dy = 0;
      } else {
        dx = 0;
      }
    }
    if (!event.altKey && drag!.box) {
      const [l, t, r, b] = drag!.box;
      const snapped = snap([l + dx, t + dy, r + dx, b + dy], drag!.lines);

      dx += snapped.x?.by ?? 0;
      dy += snapped.y?.by ?? 0;
      guides = { x: snapped.x?.at, y: snapped.y?.at };
    }

    const [ox, oy] = apply(toParent, [0, 0]);
    const [px, py] = apply(toParent, [dx, dy]);

    next = [
      ...(placement.slice(0, 4) as Matrix2),
      placement[4] + px - ox,
      placement[5] + py - oy,
    ];
  } else if (mode.kind === 'scale') {
    const own = invert(multiply(parent, placement));
    const [px, py] = apply(own, point);
    const [ax, ay] = mode.anchor;
    const [hx, hy] = mode.handle;
    let sx = mode.axes === 'y' ? 1 : (px - ax) / (hx - ax || 1);
    let sy = mode.axes === 'x' ? 1 : (py - ay) / (hy - ay || 1);

    if (event.shiftKey && mode.axes === 'xy') {
      const uniform = Math.max(Math.abs(sx), Math.abs(sy));

      sx = Math.sign(sx || 1) * uniform;
      sy = Math.sign(sy || 1) * uniform;
    }
    // Scale about the anchor, in the instance's own space
    next = multiply(placement, [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay]);
  } else {
    const pivot: [number, number] = [placement[4], placement[5]];
    const from = apply(toParent, start);
    const to = apply(toParent, point);
    let angle =
      Math.atan2(to[1] - pivot[1], to[0] - pivot[0]) -
      Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);

    if (event.shiftKey) {
      angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    }

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Turn about the registration point, in the parent's space
    next = multiply(
      [
        cos,
        sin,
        -sin,
        cos,
        pivot[0] - cos * pivot[0] + sin * pivot[1],
        pivot[1] - sin * pivot[0] - cos * pivot[1],
      ],
      placement,
    );
  }

  setPlacement(instance, next);
  drag!.moved = true;
  render();
};

const box = (
  ctx: CanvasRenderingContext2D,
  matrix: Affine,
  [l, t, r, b]: Rect,
) => {
  const corners = [
    [l, t],
    [r, t],
    [r, b],
    [l, b],
  ].map((corner) => apply(matrix, corner as [number, number]));

  ctx.beginPath();
  corners.forEach(([x, y], index) =>
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y),
  );
  ctx.closePath();
  ctx.stroke();
};

addTool({
  down(point, event) {
    const mode = modeAt(point);
    const instance = inspected();

    if (!mode || !instance || event.button !== 0) {
      return false;
    }
    if (view.playing) {
      play(false);
    }
    drag = {
      instance,
      mode,
      start: point,
      placement: placementOf(instance),
      parent: absoluteOf(instance.parent!),
      box: instanceBox(instance),
      lines: snapLines(instance),
      moved: false,
    };
    return true;
  },
  move(point, event) {
    if (!drag) {
      return false;
    }
    update(point, event);
    return true;
  },
  up() {
    if (drag?.moved) {
      commit(drag.instance, placementOf(drag.instance));
    }
    drag = undefined;
    guides = {};
  },
  draw(ctx, pixel) {
    const instance = inspected();
    const own = handlesShown(instance) ? ownBox(instance) : undefined;

    if (!instance || !own) {
      return;
    }

    const matrix = absoluteOf(instance);
    const knob = knobOf(instance, own);
    const top = apply(matrix, [(own[0] + own[2]) / 2, own[1]]);
    const extent = stageExtent();

    ctx.setLineDash([]);
    ctx.lineWidth = pixel;
    ctx.strokeStyle = 'rgba(30,140,255,1)';
    box(ctx, matrix, own);
    ctx.beginPath();
    ctx.moveTo(...top);
    ctx.lineTo(...knob);
    ctx.stroke();

    ctx.fillStyle = 'white';
    for (const handle of handlesOf(own)) {
      const [x, y] = apply(matrix, handle.at);

      ctx.fillRect(
        x - HANDLE * pixel,
        y - HANDLE * pixel,
        2 * HANDLE * pixel,
        2 * HANDLE * pixel,
      );
      ctx.strokeRect(
        x - HANDLE * pixel,
        y - HANDLE * pixel,
        2 * HANDLE * pixel,
        2 * HANDLE * pixel,
      );
    }
    ctx.beginPath();
    ctx.arc(knob[0], knob[1], HANDLE * pixel, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // The registration point, which rotation turns about
    const origin = apply(matrix, [0, 0]);

    ctx.beginPath();
    ctx.arc(origin[0], origin[1], 2.5 * pixel, 0, Math.PI * 2);
    ctx.stroke();

    if (extent) {
      ctx.strokeStyle = 'rgba(255,0,200,0.9)';
      ctx.setLineDash([4 * pixel, 3 * pixel]);
      ctx.beginPath();
      if (guides.x !== undefined) {
        ctx.moveTo(guides.x, extent[1] - 1000);
        ctx.lineTo(guides.x, extent[3] + 1000);
      }
      if (guides.y !== undefined) {
        ctx.moveTo(extent[0] - 1000, guides.y);
        ctx.lineTo(extent[2] + 1000, guides.y);
      }
      ctx.stroke();
    }
  },
  cursor(point) {
    const mode = drag?.mode ?? modeAt(point);

    return !mode
      ? undefined
      : mode.kind === 'move'
        ? 'move'
        : mode.kind === 'rotate'
          ? 'grab'
          : mode.axes === 'x'
            ? 'ew-resize'
            : mode.axes === 'y'
              ? 'ns-resize'
              : 'nwse-resize';
  },
});
