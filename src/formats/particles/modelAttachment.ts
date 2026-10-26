import type { ModelScene } from '../w3dScene';

/**
 * A model to show a particle effect on, reduced to what the preview needs:
 * its triangles in model space, flat, and where each bone sits in the bind
 * pose, so the effect can be started on a bone as a unit carries it.
 */

export interface AttachedModel {
  name: string;
  /** Three floats a vertex, three vertices a triangle, unindexed */
  triangles: number[];
  bones: { name: string; position: [number, number, number] }[];
}

/** Rotates a vector by a quaternion given as x, y, z, w */
const rotate = (
  [x, y, z]: [number, number, number],
  [qx, qy, qz, qw]: number[],
): [number, number, number] => {
  // v + 2w(q×v) + 2q×(q×v)
  const cx = qy * z - qz * y;
  const cy = qz * x - qx * z;
  const cz = qx * y - qy * x;
  const dx = qy * cz - qz * cy;
  const dy = qz * cx - qx * cz;
  const dz = qx * cy - qy * cx;

  return [
    x + 2 * (qw * cx + dx),
    y + 2 * (qw * cy + dy),
    z + 2 * (qw * cz + dz),
  ];
};

/** Multiplies quaternions a then b, as x, y, z, w */
const compose = (a: number[], b: number[]): number[] => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** The flat triangles and bone positions of a built model */
export const attachedModel = (
  name: string,
  scene: ModelScene,
): AttachedModel => {
  const triangles: number[] = [];

  for (const mesh of scene.meshes) {
    for (const index of mesh.indices) {
      triangles.push(
        mesh.positions[index * 3],
        mesh.positions[index * 3 + 1],
        mesh.positions[index * 3 + 2],
      );
    }
  }

  const skeleton = scene.skeleton;
  const world: { position: [number, number, number]; rotation: number[] }[] =
    [];

  skeleton?.names.forEach((_, bone) => {
    const local: [number, number, number] = [
      skeleton.translations[bone * 3],
      skeleton.translations[bone * 3 + 1],
      skeleton.translations[bone * 3 + 2],
    ];
    const rotation = skeleton.rotations.slice(bone * 4, bone * 4 + 4);
    const parent = world[skeleton.parents[bone]];

    world.push(
      parent
        ? {
            position: rotate(local, parent.rotation).map(
              (value, axis) => value + parent.position[axis],
            ) as [number, number, number],
            rotation: compose(parent.rotation, rotation),
          }
        : { position: local, rotation },
    );
  });

  return {
    name,
    triangles,
    bones: (skeleton?.names ?? []).map((bone, at) => ({
      name: bone,
      position: world[at].position,
    })),
  };
};
