import type { SampledChannel, W3dAnimation } from './w3dAnimation';
import type { SceneMesh, SceneSkeleton } from './w3dScene';

/**
 * Poses a skeleton and skins a model on it: every bone's transform is the
 * bind pose composed with the animation's change for that frame (rotation
 * then translation in the bind rotation's frame, as mint's `pose.rs` has
 * it, the root's own channels ignored), and each vertex follows its bone.
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

/** A skeleton posed at one frame: every bone's transform and visibility */
export interface Pose {
  /** Every bone in model space */
  world: BoneTransform[];
  /** Whether each bone is shown, from its visibility channel */
  visible: boolean[];
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

/** Samples one channel at a fractional frame, blending its neighbours */
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
    return channel.present[second] ? at(second) : undefined;
  }

  const a = at(first);

  if (!channel.present[second] || t === 0 || channel.kind === 'visibility') {
    return a;
  }

  const b = at(second);

  if (width === 1) {
    return [a[0] + (b[0] - a[0]) * t];
  }

  // The shorter way round
  const sign =
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;

  return normalise(
    a.map((value, index) => value + (b[index] * sign - value) * t),
  );
};

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

  for (let bone = 0; bone < count; bone++) {
    const delta: BoneTransform = { t: [0, 0, 0], q: [0, 0, 0, 1] };
    let shown = true;

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
  }

  return { world, visible };
};

/**
 * Writes a bound mesh's vertices, and normals, as its bones now stand;
 * a vertex whose bone the pose lacks keeps its bind place
 */
export const skin = (
  mesh: SceneMesh,
  pose: Pose,
  positions: Float32Array,
  normals?: Float32Array,
): void => {
  const local = mesh.local;

  if (!local) {
    positions.set(mesh.positions);
    return;
  }
  for (let vertex = 0; vertex < local.bones.length; vertex++) {
    const bone = pose.world[local.bones[vertex]];
    const at = vertex * 3;

    if (!bone) {
      positions.set(mesh.positions.subarray(at, at + 3), at);
      continue;
    }

    const p = rotate(bone.q, [
      local.positions[at],
      local.positions[at + 1],
      local.positions[at + 2],
    ]);

    positions[at] = p[0] + bone.t[0];
    positions[at + 1] = p[1] + bone.t[1];
    positions[at + 2] = p[2] + bone.t[2];
    if (normals && local.normals) {
      normals.set(
        rotate(bone.q, [
          local.normals[at],
          local.normals[at + 1],
          local.normals[at + 2],
        ]),
        at,
      );
    }
  }
};

/** Builds line segments from every bone to its parent, three floats a point */
export const buildBoneLines = (skeleton: SceneSkeleton, pose: Pose): number[] =>
  pose.world.flatMap((bone, index) => {
    const parent = pose.world[skeleton.parents[index]];

    return parent ? [...parent.t, ...bone.t] : [];
  });
