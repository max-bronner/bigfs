import type { Vec3 } from '../../formats/w3d/w3dPose';

/**
 * An orbit camera around a point, Z up as in the games: drag to orbit,
 * scroll to zoom, double-click to go back to where it started.
 */

export interface Orbit {
  /** View times projection, column major */
  viewProjection(aspect: number): Float32Array;
  /** Unit vector from the target towards the eye */
  towardsEye(): Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
};

export const createOrbit = (
  canvas: HTMLCanvasElement,
  target: Vec3,
  radius: number,
  onChange: () => void,
): Orbit => {
  const initial = { yaw: -Math.PI / 4, pitch: 0.4, distance: radius * 2.6 };
  const camera = { ...initial };
  const eye = (): Vec3 => [
    target[0] + camera.distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
    target[1] + camera.distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
    target[2] + camera.distance * Math.sin(camera.pitch),
  ];

  let dragging: { x: number; y: number } | undefined;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', () => (dragging = undefined));
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    camera.yaw -= (event.clientX - dragging.x) * 0.01;
    camera.pitch = Math.max(
      -1.5,
      Math.min(1.5, camera.pitch + (event.clientY - dragging.y) * 0.01),
    );
    dragging = { x: event.clientX, y: event.clientY };
    onChange();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      camera.distance = Math.max(
        radius * 0.2,
        Math.min(radius * 20, camera.distance * Math.exp(event.deltaY * 0.001)),
      );
      onChange();
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', () => {
    Object.assign(camera, initial);
    onChange();
  });

  return {
    towardsEye: () => unit(sub(eye(), target)),
    viewProjection: (aspect) => {
      const from = eye();
      const z = unit(sub(from, target));
      const x = unit(cross([0, 0, 1], z));
      const y = cross(z, x);
      const near = radius / 100;
      const far = radius * 100;
      const f = 1 / Math.tan(Math.PI / 8);
      // prettier-ignore
      const view = [
        x[0], y[0], z[0], 0,
        x[1], y[1], z[1], 0,
        x[2], y[2], z[2], 0,
        -dot(x, from), -dot(y, from), -dot(z, from), 1,
      ];
      // prettier-ignore
      const projection = [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
      ];
      const out = new Float32Array(16);

      for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
          for (let k = 0; k < 4; k++) {
            out[column * 4 + row] +=
              projection[k * 4 + row] * view[column * 4 + k];
          }
        }
      }
      return out;
    },
  };
};
