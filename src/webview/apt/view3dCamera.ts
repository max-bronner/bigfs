import type { BoneTransform, Vec3 } from '../../formats/w3d/w3dPose';
import { rotate } from '../../formats/w3d/w3dPose';
import type { ModelScene, SceneSkeleton } from '../../formats/w3d/w3dScene';
import { composeViewProjection } from '../shared/viewProjection';

/**
 * The cameras a `View3D` surface is seen through, ported from mint's
 * `view3d.rs`. Every retail render object carries a `CAMERA` pivot; one that
 * does not, as a mod's may, is framed whole from far away.
 */

/** `tan(25°)`: WW3D's default lens is 50 degrees wide */
const HALF_WIDE_TANGENT = 0.46630766;
const NEAR = 1;
const FAR = 100000;
/** Vertical lens of a model with no camera: narrow, so flat planes stacked in depth line up */
const FRAMING_FIELD = 0.1;

const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Finds the pivot a render object is seen through, or -1 */
export const findCameraBone = (skeleton: SceneSkeleton): number =>
  skeleton.names.findIndex((name) => name.toLowerCase() === 'camera');

/**
 * Computes the view through a posed pivot at a picture's aspect: a W3D camera
 * looks down its local -Z with +Y up, and its lens spans the picture's width
 * at any aspect.
 */
export const lookThroughBone = (
  { t, q }: BoneTransform,
  aspect: number,
): Float32Array =>
  composeViewProjection({
    eye: t,
    towardsEye: normalize(rotate(q, [0, 0, 1])),
    up: normalize(rotate(q, [0, 1, 0])),
    focalLength: aspect / HALF_WIDE_TANGENT,
    aspect,
    near: NEAR,
    far: FAR,
  });

/** Computes a view of a whole model, square-on down its flattest axis */
export const frameModel = (
  { min, max }: ModelScene['bounds'],
  aspect: number,
): Float32Array => {
  const size = [0, 1, 2].map((axis) => Math.max(1e-3, max[axis] - min[axis]));
  const centre = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  const flattest = size.indexOf(Math.min(...size));
  const across = [0, 1, 2].filter((axis) => axis !== flattest);
  const [wide, tall] = flattest === 2 ? across : [across[0], 2];
  const focalLength = 1 / Math.tan(FRAMING_FIELD / 2);
  const distance =
    (Math.max(size[wide] / aspect, size[tall]) / 2) * focalLength +
    size[flattest];
  const towardsEye: Vec3 = [0, 0, 0];
  const up: Vec3 = [0, 0, 0];

  towardsEye[flattest] = 1;
  up[tall] = 1;
  return composeViewProjection({
    eye: [
      centre[0] + towardsEye[0] * distance,
      centre[1] + towardsEye[1] * distance,
      centre[2] + towardsEye[2] * distance,
    ],
    towardsEye,
    up,
    focalLength,
    aspect,
    near: Math.max(NEAR, distance - size[flattest] * 2),
    far: distance + size[flattest] * 2,
  });
};
