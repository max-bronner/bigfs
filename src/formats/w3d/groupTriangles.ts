import type { W3dMaterialPass, W3dMeshMaterials } from "./w3dMaterialChunks";
import type { W3dMaterialGeometry } from "./w3dMaterialTypes";

/** The ids of one set of triangles that draw alike */
export interface MaterialGroup {
  texture?: number;
  detailTexture?: number;
  shader?: number;
  fxMaterial?: number;
  vertexMaterial?: number;
  triangles: number[];
}

/**
 * A table's id for a triangle: one id speaks for every triangle. An id past
 * the `tableLength` entries it indexes names nothing, and neither does the
 * id a table stores for a triangle it says nothing about.
 */
const pickId = (ids: readonly number[], at: number, tableLength: number): number | undefined => {
  const id = ids.length > 1 ? ids[at] : ids[0];

  return id < tableLength ? id : undefined;
};

/**
 * Sorts a pass's triangles by what they draw with, keeping first-seen order.
 * A mesh with one of each, or with `isSplit` off, has one group holding no
 * triangles: the whole mesh.
 */
export const groupTriangles = (
  pass: W3dMaterialPass,
  { indices }: W3dMaterialGeometry,
  materials: W3dMeshMaterials,
  isSplit: boolean,
): MaterialGroup[] => {
  const textureIds = pass.stages[0]?.textureIds ?? [];
  const detailTextureIds = pass.stages[1]?.textureIds ?? [];
  const vertexMaterialIds = pass.vertexMaterialIds;
  const { textures, shaders, fxMaterials, vertexMaterials } = materials;
  const perTriangle =
    isSplit &&
    [textureIds, detailTextureIds, pass.shaderIds, pass.fxMaterialIds, vertexMaterialIds].some(
      (ids) => ids.length > 1,
    );

  if (!perTriangle) {
    return [
      {
        texture: pickId(textureIds, 0, textures.length),
        detailTexture: pickId(detailTextureIds, 0, textures.length),
        shader: pickId(pass.shaderIds, 0, shaders.length),
        fxMaterial: pickId(pass.fxMaterialIds, 0, fxMaterials.length),
        vertexMaterial: pickId(vertexMaterialIds, 0, vertexMaterials.length),
        triangles: [],
      },
    ];
  }

  const groups = new Map<string, MaterialGroup>();

  for (let triangle = 0; triangle * 3 < indices.length; triangle++) {
    const texture = pickId(textureIds, triangle, textures.length);
    const detailTexture = pickId(detailTextureIds, triangle, textures.length);
    const shader = pickId(pass.shaderIds, triangle, shaders.length);
    const fxMaterial = pickId(pass.fxMaterialIds, triangle, fxMaterials.length);
    // That table is per vertex, and a triangle takes its first vertex's material
    const vertexMaterial = pickId(vertexMaterialIds, indices[triangle * 3], vertexMaterials.length);
    const key = `${texture}|${detailTexture}|${shader}|${fxMaterial}|${vertexMaterial}`;
    let group = groups.get(key);

    if (!group) {
      group = { texture, detailTexture, shader, fxMaterial, vertexMaterial, triangles: [] };
      groups.set(key, group);
    }
    group.triangles.push(triangle);
  }

  return groups.size > 1
    ? [...groups.values()]
    : [...groups.values()].map((group) => ({ ...group, triangles: [] }));
};

/** Copies the indices of a group's triangles; absent for a group that draws the whole mesh */
export const getIndices = (group: MaterialGroup, indices: Uint32Array) => {
  if (!group.triangles.length) {
    return undefined;
  }

  const out = new Uint32Array(group.triangles.length * 3);

  group.triangles.forEach((triangle, at) => {
    out.set(indices.subarray(triangle * 3, triangle * 3 + 3), at * 3);
  });
  return out;
};
