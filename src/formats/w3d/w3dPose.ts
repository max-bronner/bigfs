import { slerp } from './w3dAnimation';
import type { SampledChannel, W3dAnimation } from './w3dAnimation';
import type { SceneMesh, SceneSkeleton } from './w3dScene';
import { skinVertices, toBoneMatrix } from './w3dSkin';

/**
 * Poses a skeleton and skins a model on it: every bone's transform is the
 * bind pose composed with the animation's change for that frame (rotation
 * then translation in the bind rotation's frame, as mint's `pose.rs` has
 * it, the root's own channels ignored), and each vertex follows its bones.
 * Pure, so the W3D viewer and the particle preview pose the same way.
 */

/** A 3D vector as `[x, y, z]` */
export type Vec3 = [number, number, number];
/** A rotation quaternion as `[x, y, z, w]` */
export type Quat = [number, number, number, number];

/** A bone's translation and rotation */
export interface BoneTransform {
  t: Vec3;
  q: Quat;
}

/** A skeleton posed at one frame: every bone's transform, visibility and opacity */
export interface Pose {
  /** Every bone in model space */
  world: BoneTransform[];
  /** Whether each bone is shown, from its visibility channel */
  visible: boolean[];
  /** Each bone's opacity from 0 to 1, from its type 15 channel */
  opacity: number[];
}

const multiply = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Rotates `v` by `q`: v + 2w(q×v) + 2q×(q×v) */
export const rotate = ([x, y, z, w]: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);

  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};

const normalise = <T extends number[]>(q: T): T => {
  const length = Math.hypot(...q) || 1;

  return q.map((value) => value / length) as T;
};

/** Composes two transforms, `outer` applied after `inner` */
const compose = (outer: BoneTransform, inner: BoneTransform): BoneTransform => {
  const r = rotate(outer.q, inner.t);

  return {
    t: [r[0] + outer.t[0], r[1] + outer.t[1], r[2] + outer.t[2]],
    q: normalise(multiply(outer.q, inner.q)),
  };
};

/**
 * Samples one channel at a fractional frame, blending its neighbours. A frame
 * outside a dense channel's range is the bind pose, not the nearest value, as
 * mint's `sample_dense` has it from EA's `MotionChannelClass`.
 */
const sample = (
  channel: SampledChannel,
  frame: number,
  frameCount: number,
): number[] | undefined => {
  const width = channel.kind === 'rotation' ? 4 : 1;
  const first = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
  const second = Math.min(frameCount - 1, first + 1);
  const t = frame - Math.floor(frame);
  const at = (index: number) =>
    Array.from(channel.values.subarray(index * width, index * width + width));

  if (!channel.present[first]) {
    return undefined;
  }

  const a = at(first);

  if (t === 0 || channel.kind === 'visibility') {
    return a;
  }
  if (!channel.present[second]) {
    return undefined;
  }

  const b = at(second);

  if (width === 1) {
    return [a[0] + (b[0] - a[0]) * t];
  }

  return slerp(a, b, t);
};

/** The bones of a skeleton, as two skeletons are compared by */
export type SkeletonBones = Pick<SceneSkeleton, 'names' | 'parents'>;

/** Whether two hierarchies are one skeleton under two names: the same bones, by name and parent, in order */
const isSameSkeleton = (a: SkeletonBones, b: SkeletonBones): boolean =>
  a.names.length === b.names.length &&
  a.names.every(
    (name, at) =>
      a.parents[at] === b.parents[at] &&
      name.toLowerCase() === b.names[at].toLowerCase(),
  );

/**
 * Says why an animation cannot play on a skeleton, or nothing when it can. A
 * channel moves a bone by its number, so a clip of another rig would move the
 * wrong bones; a renamed copy of the same rig is fine. Ported from mint's
 * `ModelAnimation::bind`.
 * @param clipSkeleton The skeleton the animation names, when it was found
 */
export const findBindRefusal = (
  skeleton: SceneSkeleton,
  animation: Pick<W3dAnimation, 'name' | 'hierarchyName'>,
  clipSkeleton: SkeletonBones | undefined,
): string | undefined =>
  animation.hierarchyName.toLowerCase() === skeleton.name.toLowerCase() ||
  (clipSkeleton && isSameSkeleton(skeleton, clipSkeleton))
    ? undefined
    : `${animation.name} is not played: it is made for ${animation.hierarchyName}${clipSkeleton ? `, a different skeleton from ${skeleton.name}` : `, which was not found, not ${skeleton.name}`}`;

/** Reads a type 15 sample, as mint's `type15_opacity`: below zero or not a number is clear */
const toOpacity = (raw: number): number =>
  Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;

/** Poses every bone in model space at `frame`, or in the bind pose without an animation */
export const poseAt = (
  skeleton: SceneSkeleton,
  animation?: W3dAnimation,
  frame = 0,
): Pose => {
  const count = skeleton.parents.length;
  const byBone = new Map<number, SampledChannel[]>();

  for (const channel of animation?.channels ?? []) {
    if (channel.pivot > 0 && channel.pivot < count) {
      byBone.set(channel.pivot, [
        ...(byBone.get(channel.pivot) ?? []),
        channel,
      ]);
    }
  }

  const world: BoneTransform[] = [];
  const visible: boolean[] = [];
  const opacity: number[] = [];

  for (let bone = 0; bone < count; bone++) {
    const delta: BoneTransform = { t: [0, 0, 0], q: [0, 0, 0, 1] };
    let shown = true;
    let opaqueness = 1;

    for (const channel of byBone.get(bone) ?? []) {
      const value = sample(channel, frame, animation!.frameCount);

      if (!value) {
        continue;
      }
      switch (channel.kind) {
        case 'x':
          delta.t[0] = value[0];
          break;
        case 'y':
          delta.t[1] = value[0];
          break;
        case 'z':
          delta.t[2] = value[0];
          break;
        case 'rotation':
          delta.q = value as Quat;
          break;
        case 'visibility':
          shown = value[0] > 0.5;
          break;
        case 'opacity':
          opaqueness = toOpacity(value[0]);
          break;
      }
    }

    const bind: BoneTransform = {
      t: skeleton.translations.slice(bone * 3, bone * 3 + 3) as Vec3,
      q: skeleton.rotations.slice(bone * 4, bone * 4 + 4) as Quat,
    };
    const local = compose(bind, delta);
    const parent = skeleton.parents[bone];

    world.push(
      parent >= 0 && parent < bone ? compose(world[parent], local) : local,
    );
    visible.push(shown);
    opacity.push(opaqueness);
  }

  return { world, visible, opacity };
};

/**
 * Whether a pose shows a mesh. Visibility and opacity belong to a bone and are
 * not inherited, and in mint only a rigid mesh answers to them: a skin has no
 * one bone, so it is always shown and whole.
 */
export const isMeshShown = (mesh: SceneMesh, pose: Pose): boolean =>
  mesh.bone === undefined || (pose.visible[mesh.bone] ?? true);

/** Gets a mesh's opacity in a pose; see `isMeshShown` for which meshes have one */
export const getMeshOpacity = (mesh: SceneMesh, pose: Pose): number =>
  mesh.bone === undefined ? 1 : (pose.opacity[mesh.bone] ?? 1);

/**
 * Writes a mesh's vertices, and normals, as its bones now stand; a vertex
 * none of whose bones the pose has keeps its bind place
 */
export const skin = (
  mesh: SceneMesh,
  pose: Pose,
  positions: Float32Array,
  normals?: Float32Array,
): void => {
  positions.set(mesh.positions);
  if (normals && mesh.normals) {
    normals.set(mesh.normals);
  }
  if (mesh.local) {
    skinVertices(
      mesh.local,
      pose.world.map((bone) => toBoneMatrix(bone.t, bone.q)),
      positions,
      normals,
    );
  }
};

/** Builds line segments from every bone to its parent, three floats a point */
export const buildBoneLines = (skeleton: SceneSkeleton, pose: Pose): number[] =>
  pose.world.flatMap((bone, index) => {
    const parent = pose.world[skeleton.parents[index]];

    return parent ? [...parent.t, ...bone.t] : [];
  });
