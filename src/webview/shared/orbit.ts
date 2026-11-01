import type { Vec3 } from '../../formats/w3d/w3dPose';
import { computeOrbitBasis } from './orbitBasis';
import type { CameraBasis, OrbitPlace } from './orbitBasis';
import { composeViewProjection } from './viewProjection';

/**
 * An orbit camera around a point, Z up as in the games: drag to orbit,
 * right-drag to pan, scroll to zoom, double-click to go back to where it
 * was last framed.
 */

/** Orbit camera state a page reads each frame to draw */
export interface Orbit {
  /** Gets the camera frame, turned by `shake` radians when the view shakes */
  getBasis(shake?: number): CameraBasis;
  /** Returns view times projection, column major */
  getViewProjection(basis: CameraBasis, aspect: number): Float32Array;
  /** Looks at a sphere from its opening angle */
  frame(target: Vec3, radius: number): void;
  /** Looks at another point from where the camera stands */
  setTarget(target: Vec3): void;
}

const INITIAL_YAW = -Math.PI / 4;
const INITIAL_PITCH = 0.4;
/** Distance from a framed sphere, in radii */
const FRAMING = 2.6;
/** The farthest out the wheel goes, whatever is framed: a large effect runs that far */
const MIN_ZOOM_LIMIT = 8000;
/** Depth range around the distance, so zooming keeps the scene between the planes */
const DEPTH_RANGE = 300;
const FOCAL_LENGTH = 1 / Math.tan(Math.PI / 8);
const ORBIT_SPEED = 0.01;
const PAN_SPEED = 1 / 600;

/** Creates an orbit camera around `target` driven by the canvas's pointer and wheel; `onChange` asks for a redraw */
export const createOrbit = (
  canvas: HTMLCanvasElement,
  target: Vec3,
  radius: number,
  onChange: () => void,
): Orbit => {
  const framed = { target, radius };
  const place: OrbitPlace = {
    yaw: INITIAL_YAW,
    pitch: INITIAL_PITCH,
    distance: radius * FRAMING,
    target,
  };

  const reset = () => {
    place.yaw = INITIAL_YAW;
    place.pitch = INITIAL_PITCH;
    place.distance = framed.radius * FRAMING;
    place.target = framed.target;
    onChange();
  };

  let dragging: { x: number; y: number; isPan: boolean } | undefined;

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, isPan: event.button !== 0 };
  });
  canvas.addEventListener('pointerup', () => (dragging = undefined));
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }

    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;

    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (dragging.isPan) {
      const { right, up } = computeOrbitBasis(place);
      const scale = place.distance * PAN_SPEED;

      place.target = place.target.map(
        (axis, at) => axis - right[at] * dx * scale + up[at] * dy * scale,
      ) as Vec3;
    } else {
      place.yaw -= dx * ORBIT_SPEED;
      place.pitch = Math.max(-1.5, Math.min(1.5, place.pitch + dy * ORBIT_SPEED));
    }
    onChange();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      place.distance = Math.max(
        framed.radius * 0.2,
        Math.min(
          Math.max(framed.radius * 20, MIN_ZOOM_LIMIT),
          place.distance * Math.exp(event.deltaY * 0.001),
        ),
      );
      onChange();
    },
    { passive: false },
  );
  canvas.addEventListener('dblclick', reset);

  return {
    getBasis: (shake = 0) =>
      computeOrbitBasis({
        ...place,
        yaw: place.yaw + shake,
        pitch: place.pitch + shake * 0.6,
      }),
    getViewProjection: ({ eye, forward }, aspect) =>
      composeViewProjection({
        eye,
        towardsEye: forward.map((axis) => -axis) as Vec3,
        up: [0, 0, 1],
        focalLength: FOCAL_LENGTH,
        aspect,
        near: place.distance / DEPTH_RANGE,
        far: place.distance * DEPTH_RANGE,
      }),
    frame: (nextTarget, nextRadius) => {
      framed.target = nextTarget;
      framed.radius = nextRadius;
      reset();
    },
    setTarget: (nextTarget) => {
      place.target = nextTarget;
      onChange();
    },
  };
};
