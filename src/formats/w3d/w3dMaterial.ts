import type {
  Rgb,
  W3dFxMaterial,
  W3dMaterialPass,
  W3dMeshMaterials,
  W3dShader,
  W3dTexture,
  W3dVertexMaterial,
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

/**
 * How a draw uses its `DCG` vertex colours. On the fixed-function path they
 * replace the material's colours as a lighting source; on the effect path they
 * multiply the shaded result instead, never both (`w3d-shading.md` section
 * 1.3, `w3d-fx-shading.md`).
 */
export interface W3dVertexColourUse {
  /** The colours stand for the material's ambient */
  ambient: boolean;
  /** The colours stand for the material's diffuse, and give the alpha */
  diffuse: boolean;
  /** The colours are the lit result: an emissive-only material turns lighting off */
  replacesLighting: boolean;
  /** The colours multiply the shaded result, and give the alpha */
  multipliesResult: boolean;
  /** What the colours are multiplied by when loaded */
  scale: Rgb;
  /** What their alpha is multiplied by when loaded */
  alphaScale: number;
}

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
  ambient: Rgb;
  diffuse: Rgb;
  emissive: Rgb;
  /** Alpha the material multiplies in; only an alpha blend reads it */
  opacity: number;
  /** The texture shows as stored, without the lights: `GRADIENT_DISABLE` and `Simple.fx` */
  unlit: boolean;
  /** Stage 0's `MODULATE2X`: the lit texture doubles and saturates */
  modulate2x: boolean;
  /** Absent when the draw has no vertex colours */
  vertexColour?: W3dVertexColourUse;
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
  /** `DCG`: RGBA a vertex */
  colors?: Uint8Array;
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
  ambient: [1, 1, 1],
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  opacity: 1,
  unlit: false,
  modulate2x: false,
};

const isBlack = ([red, green, blue]: Rgb) => red === 0 && green === 0 && blue === 0;

/** `MAX_SORT_LEVEL` of `w3d_file.h`; past it a mesh sorts as if it named none, as in mint */
const MAX_SORT_LEVEL = 32;

/** The factor pairs W3DView's converter can express */
const EFFECT_BLENDS = new Set(["1,0", "2,5", "1,1"]);
/** The detail functions W3DView's converter can express */
const EFFECT_DETAIL_COLORS = new Set([0, 2, 8, 11, 12]);
/** `GRADIENT_DISABLE`, the shader byte that throws the lighting away */
const GRADIENT_DISABLE = 0;
/** The slot ROTWK's `ShaderClass::Apply` runs as `MODULATE2X` */
const GRADIENT_MODULATE2X = 5;

/** The id a per-triangle table stores for a triangle it says nothing about */
const NO_ID = 0xffffffff;

/** The ids of one set of triangles that draw alike */
interface MaterialGroup {
  texture?: number;
  shader?: number;
  fxMaterial?: number;
  vertexMaterial?: number;
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
  const vertexMaterialIds = pass.vertexMaterialIds;
  const perTriangle = [
    textureIds,
    pass.shaderIds,
    pass.fxMaterialIds,
    vertexMaterialIds,
  ].some((ids) => ids.length > 1);

  if (!perTriangle) {
    return [
      {
        texture: pickId(textureIds, 0),
        shader: pickId(pass.shaderIds, 0),
        fxMaterial: pickId(pass.fxMaterialIds, 0),
        vertexMaterial: pickId(vertexMaterialIds, 0),
        triangles: [],
      },
    ];
  }

  const groups = new Map<string, MaterialGroup>();

  for (let triangle = 0; triangle * 3 < indices.length; triangle++) {
    const texture = pickId(textureIds, triangle);
    const shader = pickId(pass.shaderIds, triangle);
    const fxMaterial = pickId(pass.fxMaterialIds, triangle);
    // That table is per vertex, and a triangle takes its first vertex's material
    const vertexMaterial = pickId(vertexMaterialIds, indices[triangle * 3]);
    const key = `${texture}|${shader}|${fxMaterial}|${vertexMaterial}`;
    let group = groups.get(key);

    if (!group) {
      group = { texture, shader, fxMaterial, vertexMaterial, triangles: [] };
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

/**
 * Whether a pass takes the shader-material path W3DView's converter allows,
 * rather than the fixed-function one. A conjunction: the converter refuses on
 * any one mismatch (`w3d-fx-shading.md`, "The legacy-to-effect conversion").
 */
const isEffectPath = (materials: W3dMeshMaterials, shader: W3dShader | undefined) =>
  shader !== undefined &&
  materials.passes.length === 1 &&
  materials.vertexMaterials.length === 1 &&
  EFFECT_BLENDS.has(`${shader.srcBlend},${shader.destBlend}`) &&
  shader.detailAlpha === 0 &&
  shader.primaryGradient <= 1 &&
  EFFECT_DETAIL_COLORS.has(shader.detailColor) &&
  shader.depthCompare === 3;

/**
 * Resolves what a draw's vertex colours stand for: on the fixed-function path
 * by which of the material's colours are in use, the four branches of
 * `Post_Load_Process`. Any other mix leaves the colours as loaded, as diffuse.
 */
export const resolveVertexColour = (
  isEffect: boolean,
  { ambient, diffuse, emissive, opacity }: Pick<W3dSurface, "ambient" | "diffuse" | "emissive" | "opacity">,
): W3dVertexColourUse => {
  const unscaled: W3dVertexColourUse = {
    ambient: false,
    diffuse: true,
    replacesLighting: false,
    multipliesResult: false,
    scale: [1, 1, 1],
    alphaScale: 1,
  };

  if (isEffect) {
    return { ...unscaled, diffuse: false, multipliesResult: true };
  }

  const uses = [!isBlack(diffuse), !isBlack(ambient), !isBlack(emissive)].join();

  switch (uses) {
    case "true,false,false":
      return { ...unscaled, scale: diffuse, alphaScale: opacity };
    case "true,true,false":
      return { ...unscaled, ambient: true, scale: diffuse, alphaScale: opacity };
    case "false,true,false":
      return { ...unscaled, ambient: true, diffuse: false, scale: ambient, alphaScale: opacity };
    case "false,false,true":
      return { ...unscaled, replacesLighting: true, scale: emissive, alphaScale: opacity };
    default:
      return unscaled;
  }
};

const resolveColours = ({ ambient, diffuse, emissive, opacity }: W3dVertexMaterial) => ({
  ambient,
  diffuse,
  emissive,
  opacity,
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
  const texture =
    legacyTexture ??
    (fxTexture ? { name: fxTexture, clampU: false, clampV: false } : undefined);
  const vertexMaterial = materials.vertexMaterials[group.vertexMaterial ?? -1];
  const colours = vertexMaterial ? resolveColours(vertexMaterial) : DEFAULT_SURFACE;
  const isEffect = isEffectPath(materials, shader);
  const colors =
    pass.colors?.length === geometry.vertexCount * 4 ? pass.colors : undefined;

  return {
    pass: passIndex,
    indices: getIndices(group, geometry.indices),
    surface: {
      ...DEFAULT_SURFACE,
      ...colours,
      twoSided: geometry.twoSided,
      unlit:
        shader?.primaryGradient === GRADIENT_DISABLE ||
        fxMaterial?.shaderName.toLowerCase() === "simple.fx",
      modulate2x:
        !isEffect && !!texture && shader?.primaryGradient === GRADIENT_MODULATE2X,
      vertexColour: colors && resolveVertexColour(isEffect, colours),
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
    texture,
    uvs: uvs?.length === geometry.vertexCount * 2 ? uvs : undefined,
    colors,
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
