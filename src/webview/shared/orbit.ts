import type { Vec3 } from '../../formats/w3d/w3dPose';
import { composeViewProjection } from './viewProjection';

/**
 * An orbit camera around a point, Z up as in the games: drag to orbit,
 * scroll to zoom, double-click to go back to where it started.
 */

/** Orbit camera state a page reads each frame to draw */
export interface Orbit {
  /** Returns view times projection, column major */
  viewProjection(aspect: number): Float32Array;
  /** Returns the unit vector from the target towards the eye */
  towardsEye(): Vec3;
}

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Creates an orbit camera around `target` driven by the canvas's pointer and wheel; `onChange` asks for a redraw */
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
    towardsEye: () => normalize(subtract(eye(), target)),
    viewProjection: (aspect) => {
      const from = eye();

      return composeViewProjection({
        eye: from,
        towardsEye: normalize(subtract(from, target)),
        up: [0, 0, 1],
        focalLength: 1 / Math.tan(Math.PI / 8),
        aspect,
        near: radius / 100,
        far: radius * 100,
      });
    },
  };
};
