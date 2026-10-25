import type { Vec3 } from '../../formats/particles/particleIni';
import { $, state } from './page';

/** The orbit camera: yaw and pitch around a target, at a distance */

export interface Basis {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a) || 1;

  return a.map((value) => value / length) as Vec3;
};

export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cameraBasis = (): Basis => {
  const cp = Math.cos(state.pitch);
  const sp = Math.sin(state.pitch);
  const forward: Vec3 = [
    Math.cos(state.yaw) * cp,
    Math.sin(state.yaw) * cp,
    -sp,
  ];
  const eye = state.target.map(
    (target, axis) => target - forward[axis] * state.distance,
  ) as Vec3;
  const right = normalize(cross(forward, [0, 0, 1]));

  return { eye, forward, right, up: cross(right, forward) };
};

/** Column-major view (rows right, up, -forward) times a perspective */
export const viewProjection = (
  { eye, forward, right, up }: Basis,
  canvas: HTMLCanvasElement,
): Float32Array => {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const near = 1;
  const far = 20000;
  const f = 1 / Math.tan(0.45);
  const view = [
    right[0],
    up[0],
    -forward[0],
    0,
    right[1],
    up[1],
    -forward[1],
    0,
    right[2],
    up[2],
    -forward[2],
    0,
    -dot(right, eye),
    -dot(up, eye),
    dot(forward, eye),
    1,
  ];
  const projection = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;

      for (let k = 0; k < 4; k++) {
        sum += projection[k * 4 + row] * view[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
};

/** Drag to orbit, right-drag to pan, wheel to zoom */
export const attachCamera = (canvas: HTMLCanvasElement): void => {
  let drag: { x: number; y: number; pan: boolean } | undefined;

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, pan: event.button !== 0 };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', () => (drag = undefined));
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) {
      return;
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.pan) {
      const { right, up } = cameraBasis();
      const k = state.distance / 600;

      state.target = state.target.map(
        (target, axis) => target - right[axis] * dx * k + up[axis] * dy * k,
      ) as Vec3;
    } else {
      state.yaw -= dx * 0.008;
      state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.008));
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      state.distance = Math.max(
        5,
        Math.min(8000, state.distance * Math.exp(event.deltaY * 0.001)),
      );
    },
    { passive: false },
  );
};

/** Where the previewed effect sits: still, circling or going back and forth */
export const rootOrigin = (): Vec3 => {
  const motion = $<HTMLSelectElement>('motion').value;
  const t = state.time;

  if (motion === 'circle') {
    return [Math.cos(t * 1.5) * 60, Math.sin(t * 1.5) * 60, 0];
  }
  if (motion === 'line') {
    return [Math.sin(t * 1.2) * 80, 0, 0];
  }
  return [0, 0, 0];
};
