import type {
  W3dFxMaterial,
  W3dMaterialPass,
  W3dMeshMaterials,
  W3dShader,
  W3dTexture,
} from "./w3dMaterialChunks";

/**
 * The material decisions of a W3D mesh: from the tables a mesh stores to the
 * draws that show it, one for each material pass and each set of triangles
 * that shares a texture, shader and vertex material. Plain data and no
 * renderer, so the rules can be tested against synthetic chunks. Ported from
 * mint's `convert.rs`, which `w3d-shading.md` and `w3d-fx-shading.md` explain.
 */

/** The framebuffer operations the shipped meshes use, named as mint's `Blend` */
export type W3dBlend =
  | "opaque"
  | "alpha"
  | "additive"
  | "multiply"
  | "addScaledByAlpha"
  | "addScaledByColor"
  | "addInverseScaledByColor";

/** What one draw asks of the renderer, apart from its textures and arrays */
export interface W3dSurface {
  /** How the draw meets what is behind it */
  blend: W3dBlend;
  /** Whether texels of low alpha are cut out */
  alphaTest: boolean;
  /** `D3DCMP_*` minus one, the order GL's depth functions share */
  depthCompare: number;
  /** The `TWO_SIDED` mesh attribute: its back faces draw too */
  twoSided: boolean;
  /** Draw-order bin among blended draws, 1 to 32; 0 for none */
  sortLevel: number;
}

/** One draw of a mesh, in the order the game draws them */
export interface W3dMaterialDraw {
  /** Index of the `MATERIAL_PASS` it comes from */
  pass: number;
  /** The triangles it draws; absent when it draws the whole mesh */
  indices?: Uint32Array;
  surface: W3dSurface;
  /** The first stage's texture */
  texture?: W3dTexture;
  /** Two per vertex, as stored: V measured from the bottom */
  uvs?: Float32Array;
}

/** A mesh's geometry, as much of it as its materials depend on */
export interface W3dMaterialGeometry {
  indices: Uint32Array;
  vertexCount: number;
  twoSided: boolean;
  /** `MESH_HEADER3.SortLevel` as stored */
  sortLevel: number;
}

/** The surface of a mesh with no material */
export const DEFAULT_SURFACE: W3dSurface = {
  blend: "opaque",
  alphaTest: false,
  depthCompare: 3,
  twoSided: false,
  sortLevel: 0,
};

/** `MAX_SORT_LEVEL` of `w3d_file.h`; past it a mesh sorts as if it named none, as in mint */
const MAX_SORT_LEVEL = 32;

/** The id a per-triangle table stores for a triangle it says nothing about */
const NO_ID = 0xffffffff;

/** The ids of one set of triangles that draw alike */
interface MaterialGroup {
  texture?: number;
  shader?: number;
  fxMaterial?: number;
  triangles: number[];
}

const EMPTY_PASS: W3dMaterialPass = {
  vertexMaterialIds: [],
  shaderIds: [],
  fxMaterialIds: [],
  stages: [],
};

/**
 * Picks the framebuffer operation of a shader from its factor pair, as
 * `ShaderClass::Apply` does through its tables. An alpha-blended shader that
 * writes depth and alpha-tests is a cutout: its coverage is binary, so it
 * draws as opaque. A pair the shipped files do not use blends by alpha.
 */
export const classifyBlend = (shader: W3dShader): W3dBlend => {
  const { srcBlend, destBlend, alphaTest, depthMask } = shader;

  if (destBlend === 0) {
    return "opaque";
  }
  if (destBlend === 1) {
    return "additive";
  }
  if (alphaTest && depthMask) {
    return "opaque";
  }
  if (srcBlend === 0 && destBlend === 2) {
    return "multiply";
  }
  if (srcBlend === 1 && destBlend === 2) {
    return "addScaledByColor";
  }
  if (srcBlend === 1 && destBlend === 3) {
    return "addInverseScaledByColor";
  }
  return srcBlend === 1 && destBlend === 4 ? "addScaledByAlpha" : "alpha";
};

/** Additive wins over alpha over the rest, as a glow must never turn solid */
const BLEND_RANK: W3dBlend[] = [
  "opaque",
  "multiply",
  "addInverseScaledByColor",
  "addScaledByColor",
  "addScaledByAlpha",
  "alpha",
  "additive",
];

/** Picks the blend a mesh reports for its draws: the most transparent */
export const pickMeshBlend = (surfaces: readonly W3dSurface[]): W3dBlend =>
  surfaces.reduce<W3dBlend>(
    (best, { blend }) =>
      BLEND_RANK.indexOf(blend) > BLEND_RANK.indexOf(best) ? blend : best,
    "opaque",
  );

/** A table's id for a triangle: one id speaks for every triangle */
const pickId = (ids: readonly number[], at: number): number | undefined => {
  const id = ids.length > 1 ? ids[at] : ids[0];

  return id === NO_ID ? undefined : id;
};

/**
 * Sorts a pass's triangles by what they draw with, keeping first-seen order.
 * A mesh with one of each has one group holding no triangles: the whole mesh.
 */
const groupTriangles = (
  pass: W3dMaterialPass,
  { indices }: W3dMaterialGeometry,
): MaterialGroup[] => {
  const textureIds = pass.stages[0]?.textureIds ?? [];
  const perTriangle = [textureIds, pass.shaderIds, pass.fxMaterialIds].some(
    (ids) => ids.length > 1,
  );

  if (!perTriangle) {
    return [
      {
        texture: pickId(textureIds, 0),
        shader: pickId(pass.shaderIds, 0),
        fxMaterial: pickId(pass.fxMaterialIds, 0),
        triangles: [],
      },
    ];
  }

  const groups = new Map<string, MaterialGroup>();

  for (let triangle = 0; triangle * 3 < indices.length; triangle++) {
    const texture = pickId(textureIds, triangle);
    const shader = pickId(pass.shaderIds, triangle);
    const fxMaterial = pickId(pass.fxMaterialIds, triangle);
    const key = `${texture}|${shader}|${fxMaterial}`;
    let group = groups.get(key);

    if (!group) {
      group = { texture, shader, fxMaterial, triangles: [] };
      groups.set(key, group);
    }
    group.triangles.push(triangle);
  }

  return groups.size > 1
    ? [...groups.values()]
    : [...groups.values()].map((group) => ({ ...group, triangles: [] }));
};

const getIndices = (group: MaterialGroup, indices: Uint32Array) => {
  if (!group.triangles.length) {
    return undefined;
  }

  const out = new Uint32Array(group.triangles.length * 3);

  group.triangles.forEach((triangle, at) => {
    out.set(indices.subarray(triangle * 3, triangle * 3 + 3), at * 3);
  });
  return out;
};

const readFxBool = (material: W3dFxMaterial | undefined, name: string) =>
  material?.properties.get(name) === true;

/** The surface a shader material asks for; a mesh that names a shader goes by the shader */
const resolveFxSurface = (material: W3dFxMaterial | undefined) => ({
  blend: readFxBool(material, "alphablendingenable") ? ("alpha" as const) : ("opaque" as const),
  alphaTest: readFxBool(material, "alphatestenable"),
});

const resolveDraw = (
  materials: W3dMeshMaterials,
  pass: W3dMaterialPass,
  passIndex: number,
  group: MaterialGroup,
  geometry: W3dMaterialGeometry,
): W3dMaterialDraw => {
  const shader =
    materials.shaders[group.shader ?? -1] ??
    materials.shaders[pass.shaderIds.find((id) => id !== NO_ID) ?? -1];
  const fxMaterial = materials.fxMaterials[group.fxMaterial ?? 0];
  const stage = pass.stages[0];
  const uvs = stage?.uvs?.length ? stage.uvs : pass.uvs;
  const legacyTexture = materials.textures[group.texture ?? -1];
  const fxTexture = fxMaterial && readFxDiffuseTexture(fxMaterial);

  return {
    pass: passIndex,
    indices: getIndices(group, geometry.indices),
    surface: {
      ...DEFAULT_SURFACE,
      twoSided: geometry.twoSided,
      sortLevel:
        geometry.sortLevel > 0 && geometry.sortLevel <= MAX_SORT_LEVEL ? geometry.sortLevel : 0,
      ...(shader
        ? {
            blend: classifyBlend(shader),
            alphaTest: shader.alphaTest !== 0,
            depthCompare: shader.depthCompare,
          }
        : resolveFxSurface(fxMaterial)),
    },
    texture:
      legacyTexture ??
      (fxTexture ? { name: fxTexture, clampU: false, clampV: false } : undefined),
    uvs: uvs?.length === geometry.vertexCount * 2 ? uvs : undefined,
  };
};

/**
 * Reads the texture a shader material binds by name, never by position: a
 * material is a list of named parameters, and `Simple.fx` calls its texture
 * `Texture_0`
 */
const readFxDiffuseTexture = ({ properties }: W3dFxMaterial): string | undefined => {
  const value = properties.get("diffusetexture") ?? properties.get("texture_0");

  return typeof value === "string" ? value : undefined;
};

/**
 * Resolves the draws of a mesh, a material pass at a time and in file order;
 * a mesh with no pass still has one, for what its shader material says.
 */
export const resolveMaterialDraws = (
  materials: W3dMeshMaterials,
  geometry: W3dMaterialGeometry,
): W3dMaterialDraw[] =>
  (materials.passes.length ? materials.passes : [EMPTY_PASS]).flatMap((pass, passIndex) =>
    groupTriangles(pass, geometry).map((group) =>
      resolveDraw(materials, pass, passIndex, group, geometry),
    ),
  );
