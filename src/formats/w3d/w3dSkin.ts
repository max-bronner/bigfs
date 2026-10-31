/**
 * Skinning, ported from `skin_in_place` in mint's
 * `crates/sage/model/src/convert.rs`. A vertex of a skin is stored twice, once
 * in the space of each of its two bones, and lands where its weights blend
 * the two copies. Shared by the bind pose a scene is built in and the poses
 * a player asks for, which is why it takes bare matrices.
 */

/** A 4x4 matrix, column major */
export type Matrix = Float64Array;

/** A mesh as stored, in the space of the bones its vertices follow */
export interface BoneSpaceMesh {
  positions: Float32Array;
  normals?: Float32Array;
  /** The two bones of each vertex, two a vertex */
  bones: Uint16Array;
  /**
   * The share of each of those bones, two a vertex, summing to 1. A rigid
   * mesh is a skin whose vertices all follow one bone with all their weight.
   */
  weights: Float32Array;
  /** `VERTICES_2`: each vertex in its second bone's space */
  secondPositions?: Float32Array;
  /** `VERTEX_NORMALS_2`: each normal in its second bone's space */
  secondNormals?: Float32Array;
}

/** Builds a bone's matrix from its translation and rotation: rotate, then translate */
export const toBoneMatrix = (
  [tx, ty, tz]: readonly [number, number, number],
  [x, y, z, w]: readonly [number, number, number, number],
): Matrix =>
  Float64Array.from([
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    tx,
    ty,
    tz,
    1,
  ]);

/**
 * Writes where the bones in `matrices` put a mesh's vertices and normals.
 * Without `VERTICES_2` the first bone alone moves a vertex, its weights
 * ignored, as the game does. A bone past the end of `matrices` is left out of
 * the blend and the other bone's weight stands alone; a vertex with neither
 * keeps what `positions` and `normals` already hold.
 */
export const skinVertices = (
  mesh: BoneSpaceMesh,
  matrices: readonly Matrix[],
  positions: Float32Array,
  normals?: Float32Array,
): void => {
  const { bones, weights, secondPositions, secondNormals } = mesh;
  const vertexCount = bones.length / 2;

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const at = vertex * 3;
    let px = 0;
    let py = 0;
    let pz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let applied = 0;

    for (let slot = 0; slot < 2; slot++) {
      const weight = secondPositions ? weights[vertex * 2 + slot] : 1 - slot;
      const m = matrices[bones[vertex * 2 + slot]];

      if (weight <= 0 || !m) {
        continue;
      }

      const source = (slot && secondPositions) || mesh.positions;
      const x = source[at];
      const y = source[at + 1];
      const z = source[at + 2];

      px += (m[0] * x + m[4] * y + m[8] * z + m[12]) * weight;
      py += (m[1] * x + m[5] * y + m[9] * z + m[13]) * weight;
      pz += (m[2] * x + m[6] * y + m[10] * z + m[14]) * weight;

      const normalSource = slot && secondPositions ? secondNormals : mesh.normals;

      if (normalSource) {
        const a = normalSource[at];
        const b = normalSource[at + 1];
        const c = normalSource[at + 2];

        nx += (m[0] * a + m[4] * b + m[8] * c) * weight;
        ny += (m[1] * a + m[5] * b + m[9] * c) * weight;
        nz += (m[2] * a + m[6] * b + m[10] * c) * weight;
      }
      applied += weight;
    }

    if (applied <= 0) {
      continue;
    }

    positions[at] = px / applied;
    positions[at + 1] = py / applied;
    positions[at + 2] = pz / applied;

    const length = Math.hypot(nx, ny, nz);

    if (normals && length > 0) {
      normals[at] = nx / length;
      normals[at + 1] = ny / length;
      normals[at + 2] = nz / length;
    }
  }
};
