import type { Rgb, W3dTexture } from "./w3dMaterialChunks";
import type { W3dUvMapper } from "./w3dUvMapper";

/**
 * The material decisions of a W3D mesh as data: what one draw asks of the
 * renderer, from the tables a mesh stores to the draws that show it. No
 * renderer is involved, so the rules that fill these can be tested against
 * synthetic chunks. Ported from mint's `convert.rs`, which `w3d-shading.md`
 * and `w3d-fx-shading.md` explain.
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
  /** A blended draw also writes depth: the shader's depth mask. An opaque draw always does */
  depthWrite: boolean;
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
  /** How the second stage's colour combines with the first's: `DetailColorFuncType`, 0 for none */
  detailColor: number;
  /** How the second stage's alpha combines with the first's: `DetailAlphaFuncType`, 0 for none */
  detailAlpha: number;
  /** `GRADIENT_BUMPENVMAP`: the first stage is no colour, but offsets the second's coordinates */
  bumpOffset: boolean;
  /** `NormalMapped.fx`'s highlight, added over the texture; black for none */
  specular: Rgb;
  /** The highlight's exponent */
  shininess: number;
  /** How far the normal map tilts the surface: `BumpScale` */
  bumpScale: number;
  /**
   * The material can take a house colour. Necessary only: `housecolor.ini` must
   * also list its texture (`house-color.md` section 3)
   */
  houseColourable: boolean;
  /** The UV mappers of the two stages; absent when both show their stored coordinates */
  mappers?: [W3dUvMapper, W3dUvMapper];
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
  /** The second stage's texture */
  detailTexture?: W3dTexture;
  /** The tangent-space normal map a shader material names */
  normalMap?: string;
  /** Two per vertex, as stored: V measured from the bottom */
  uvs?: Float32Array;
  /** The second stage's own coordinates, else the first stage's */
  detailUvs?: Float32Array;
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
  depthWrite: false,
  twoSided: false,
  sortLevel: 0,
  ambient: [1, 1, 1],
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  opacity: 1,
  unlit: false,
  modulate2x: false,
  detailColor: 0,
  detailAlpha: 0,
  bumpOffset: false,
  specular: [0, 0, 0],
  shininess: 1,
  bumpScale: 1,
  houseColourable: false,
};
