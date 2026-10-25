import type {
  NumericField,
  ParticleDef,
  Vec3,
} from '../../formats/particles/particleIni';
import { cameraBasis, viewProjection } from './camera';
import { canvas } from './graphics';
import { $, library, post, state, world } from './page';

/**
 * Handles on the emission volume of the previewed system, drawn over the
 * 3D view: a sphere's or cylinder's radius, a cylinder's length, a box's
 * half sizes, a line's two ends. Dragging one sets the INI value it
 * stands for, as a slider would, so it previews until applied. A handle
 * whose field the block does not write is not shown: there is no token
 * to change.
 */

interface Handle {
  /** Where it sits, relative to the system's origin */
  at: Vec3;
  /** A length along `axis` (`factor` turns a move into a value), or a free point */
  axis?: Vec3;
  factor?: number;
  /** The field ids it writes: one value, or X, Y and Z */
  ids: string[];
  values: number[];
  label: string;
}

const overlay = $<HTMLCanvasElement>('handles');
const RADIUS = 6;

const fieldsOf = () => state.scene?.fields ?? [];

/** A field of the emission volume, by any of its spellings, block or flat */
const volumeField = (names: string[], part = ''): NumericField | undefined =>
  fieldsOf().find(
    (field) =>
      names.some(
        (name) => name.toLowerCase() === field.keyword.toLowerCase(),
      ) &&
      field.part === part &&
      (!field.module || /^emissionvolume/i.test(field.module)),
  );

const valueOf = (field: NumericField) =>
  state.scene?.values[field.id] ?? field.value;

const scalar = (
  names: string[],
  at: (value: number) => Vec3,
  axis: Vec3,
  label: string,
  factor = 1,
): Handle[] => {
  const field = volumeField(names);

  return field
    ? [
        {
          at: at(valueOf(field)),
          axis,
          factor,
          ids: [field.id],
          values: [valueOf(field)],
          label,
        },
      ]
    : [];
};

const point = (names: string[], label: string): Handle[] => {
  const parts = ['X', 'Y', 'Z'].map((part) => volumeField(names, part));

  if (!parts.every(Boolean)) {
    return [];
  }

  const values = parts.map((field) => valueOf(field!));

  return [
    {
      at: values as Vec3,
      ids: parts.map((field) => field!.id),
      values,
      label,
    },
  ];
};

const handlesOf = (def: ParticleDef): Handle[] => {
  const volume = def.volume;

  switch (volume.type) {
    case 'sphere':
      return scalar(
        ['Radius', 'VolSphereRadius'],
        (r) => [r, 0, 0],
        [1, 0, 0],
        'radius',
      );
    case 'cylinder': {
      const [ox, oy, oz] = volume.offset;

      return [
        ...scalar(
          ['Radius', 'VolCylinderRadius'],
          (r) => [ox + r, oy, oz],
          [1, 0, 0],
          'radius',
        ),
        ...scalar(
          ['Length', 'VolCylinderLength'],
          (length) => [ox, oy, oz + length / 2],
          [0, 0, 1],
          'length',
          2,
        ),
      ];
    }
    case 'box':
      return (['X', 'Y', 'Z'] as const).flatMap((part, axis) => {
        const field = volumeField(['HalfSize', 'VolBoxHalfSize'], part);

        if (!field) {
          return [];
        }

        const direction: Vec3 = [0, 0, 0];

        direction[axis] = 1;
        return [
          {
            at: direction.map((each) => each * valueOf(field)) as Vec3,
            axis: direction,
            factor: 1,
            ids: [field.id],
            values: [valueOf(field)],
            label: `half ${part}`,
          },
        ];
      });
    case 'line':
      return [
        ...point(['StartPoint', 'VolLineStart'], 'start'),
        ...point(['EndPoint', 'VolLineEnd'], 'end'),
      ];
    default:
      return [];
  }
};

/** The previewed system's live instance and definition, if it is one */
const target = () => {
  const name = state.scene?.root.kind === 'system' ? state.scene.root.name : '';
  const def = library.systems.get(name.toLowerCase());
  const system = world.systems.find(
    (each) => state.roots.includes(each.id) && each.name === def?.name,
  );

  return def && system ? { def, origin: system.origin } : undefined;
};

/** A world point in CSS pixels of the view, or undefined behind the camera */
const project = (
  matrix: Float32Array,
  p: Vec3,
): [number, number] | undefined => {
  const x = matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12];
  const y = matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13];
  const w =
    matrix[3] * p[0] + matrix[7] * p[1] + matrix[11] * p[2] + matrix[15];

  if (w <= 0.001) {
    return undefined;
  }
  return [
    ((x / w + 1) / 2) * canvas.clientWidth,
    ((1 - y / w) / 2) * canvas.clientHeight,
  ];
};

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
];

let drag:
  | {
      handle: Handle;
      start: [number, number];
      /** Pixels per world unit along the axis, or along the camera's right and up */
      along: [number, number];
      right?: Vec3;
      up?: Vec3;
      perPixel?: number;
    }
  | undefined;

const shown = () =>
  ($<HTMLInputElement>('showVolume').checked && target()) || undefined;

/** Draws the handles over the view; called once per frame */
export const drawHandles = (): void => {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (overlay.width !== width * ratio || overlay.height !== height * ratio) {
    overlay.width = width * ratio;
    overlay.height = height * ratio;
  }

  const ctx = overlay.getContext('2d')!;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const found = shown();

  if (!found) {
    return;
  }

  const matrix = viewProjection(cameraBasis(), canvas);

  ctx.font = '10px sans-serif';
  for (const handle of handlesOf(found.def)) {
    const at = project(matrix, add(found.origin, handle.at));

    if (!at) {
      continue;
    }
    ctx.fillStyle = drag?.handle.label === handle.label ? '#fff' : '#ffcc33';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    if (handle.axis) {
      ctx.rect(
        at[0] - RADIUS / 1.4,
        at[1] - RADIUS / 1.4,
        RADIUS * 1.4,
        RADIUS * 1.4,
      );
    } else {
      ctx.arc(at[0], at[1], RADIUS, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffcc33';
    ctx.fillText(handle.label, at[0] + 9, at[1] - 6);
  }
};

const send = (handle: Handle, values: number[]) =>
  handle.ids.forEach((id, index) => {
    const value = Math.round(values[index] * 100) / 100;

    if (state.scene) {
      state.scene.values[id] = value;
    }
    post({ kind: 'set', id, value });
  });

/** Takes the pointer from the camera when it lands on a handle */
export const attachHandles = (): void => {
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      const found = shown();

      if (!found || event.button !== 0) {
        return;
      }

      const box = canvas.getBoundingClientRect();
      const pointer: [number, number] = [
        event.clientX - box.left,
        event.clientY - box.top,
      ];
      const matrix = viewProjection(cameraBasis(), canvas);
      const handle = handlesOf(found.def).find((each) => {
        const at = project(matrix, add(found.origin, each.at));

        return (
          at && Math.hypot(at[0] - pointer[0], at[1] - pointer[1]) <= RADIUS + 3
        );
      });

      if (!handle) {
        return;
      }
      event.stopImmediatePropagation();
      canvas.setPointerCapture(event.pointerId);

      const base = add(found.origin, handle.at);
      const from = project(matrix, base)!;

      if (handle.axis) {
        const to = project(matrix, add(base, handle.axis)) ?? from;

        drag = {
          handle,
          start: pointer,
          along: [to[0] - from[0], to[1] - from[1]],
        };
      } else {
        const { right, up } = cameraBasis();
        const step = project(matrix, add(base, right)) ?? from;

        drag = {
          handle,
          start: pointer,
          along: [0, 0],
          right,
          up,
          perPixel:
            1 /
            Math.max(1e-3, Math.hypot(step[0] - from[0], step[1] - from[1])),
        };
      }
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      if (!drag) {
        return;
      }
      event.stopImmediatePropagation();

      const box = canvas.getBoundingClientRect();
      const dx = event.clientX - box.left - drag.start[0];
      const dy = event.clientY - box.top - drag.start[1];
      const { handle } = drag;

      if (handle.axis) {
        const [ax, ay] = drag.along;
        const length = ax * ax + ay * ay;
        const moved = length > 1e-6 ? (dx * ax + dy * ay) / length : 0;

        send(handle, [
          Math.max(0, handle.values[0] + moved * (handle.factor ?? 1)),
        ]);
      } else {
        const offset = add(
          add([0, 0, 0], drag.right!, dx * drag.perPixel!),
          drag.up!,
          -dy * drag.perPixel!,
        );

        send(
          handle,
          handle.values.map((value, axis) => value + offset[axis]),
        );
      }
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointerup',
    () => {
      drag = undefined;
    },
    { capture: true },
  );
};
