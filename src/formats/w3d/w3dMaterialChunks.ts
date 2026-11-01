import { createView, readChunks, readFloats, readIds, readName } from "./w3dChunks";

/**
 * Reader for the material tables of a W3D mesh, as stored: the shaders, the
 * vertex materials, the textures, the shader materials and the passes that
 * index them. What these mean for a draw is `resolveMaterialDraws.ts`'s to decide.
 * Layouts are EA's `w3d_file.h`; the shader material chunks are mint's
 * `material.rs`, derived from the shipped files.
 */

/** An RGB colour, each channel 0 to 1 */
export type Rgb = [number, number, number];

/** One `SHADERS` entry, its bytes named as `W3dShaderStruct` orders them */
export interface W3dShader {
  depthCompare: number;
  depthMask: number;
  destBlend: number;
  primaryGradient: number;
  srcBlend: number;
  texturing: number;
  detailColor: number;
  detailAlpha: number;
  alphaTest: number;
}

/** One `VERTEX_MATERIAL`: its colours and the UV mapper of each texture stage */
export interface W3dVertexMaterial {
  /** `VERTEX_MATERIAL_INFO`'s attribute word, naming the two stages' mappers */
  attributes: number;
  ambient: Rgb;
  diffuse: Rgb;
  emissive: Rgb;
  opacity: number;
  /** `VERTEX_MAPPER_ARGS0`, the first stage's mapper arguments as text */
  mapperArgs0?: string;
  /** `VERTEX_MAPPER_ARGS1`, the second stage's */
  mapperArgs1?: string;
}

/** One entry of a mesh's `TEXTURES` table */
export interface W3dTexture {
  name: string;
  clampU: boolean;
  clampV: boolean;
}

/** The value of a shader material's named parameter */
export type W3dFxValue = string | number | boolean | number[];

/** One `SHADER_MATERIAL`: a compiled effect and its named parameters */
export interface W3dFxMaterial {
  /** File name of the effect, such as `NormalMapped.fx` */
  shaderName: string;
  /** Parameters by lower-case name, as the engine matches them without casing */
  properties: Map<string, W3dFxValue>;
}

/** One `TEXTURE_STAGE` of a material pass */
export interface W3dTextureStage {
  /** One texture for the pass, or one a triangle */
  textureIds: number[];
  /** Two per vertex, as stored */
  uvs?: Float32Array;
}

/** One `MATERIAL_PASS`: the ids into the mesh's tables and its per-vertex arrays */
export interface W3dMaterialPass {
  /** One vertex material for the pass, or one a vertex */
  vertexMaterialIds: number[];
  /** One shader for the pass, or one a triangle */
  shaderIds: number[];
  /** One shader material for the pass, or one a triangle */
  fxMaterialIds: number[];
  stages: W3dTextureStage[];
  /** Coordinates a shader-material pass keeps on itself rather than on a stage */
  uvs?: Float32Array;
  /** `DCG`: RGBA a vertex */
  colors?: Uint8Array;
}

/** Every material table of one mesh */
export interface W3dMeshMaterials {
  shaders: W3dShader[];
  vertexMaterials: W3dVertexMaterial[];
  textures: W3dTexture[];
  fxMaterials: W3dFxMaterial[];
  passes: W3dMaterialPass[];
}

const CHUNK = {
  SHADERS: 0x029,
  VERTEX_MATERIALS: 0x02a,
  VERTEX_MATERIAL: 0x02b,
  VERTEX_MATERIAL_INFO: 0x02d,
  VERTEX_MAPPER_ARGS0: 0x02e,
  VERTEX_MAPPER_ARGS1: 0x02f,
  TEXTURES: 0x030,
  TEXTURE: 0x031,
  TEXTURE_NAME: 0x032,
  TEXTURE_INFO: 0x033,
  MATERIAL_PASS: 0x038,
  VERTEX_MATERIAL_IDS: 0x039,
  SHADER_IDS: 0x03a,
  DCG: 0x03b,
  SHADER_MATERIAL_ID: 0x03f,
  TEXTURE_STAGE: 0x048,
  TEXTURE_IDS: 0x049,
  STAGE_TEXCOORDS: 0x04a,
  SHADER_MATERIALS: 0x050,
  SHADER_MATERIAL: 0x051,
  SHADER_MATERIAL_HEADER: 0x052,
  SHADER_MATERIAL_PROPERTY: 0x053,
};

/**
 * Stands for a vertex material with no `VERTEX_MATERIAL_INFO`, which keeps the
 * table's indices right: white and opaque, not the zeroes of an empty struct,
 * which would draw black (mint's `NEUTRAL_MATERIAL`)
 */
const NO_INFO: W3dVertexMaterial = {
  attributes: 0,
  ambient: [1, 1, 1],
  diffuse: [1, 1, 1],
  emissive: [0, 0, 0],
  opacity: 1,
};

const SHADER_SIZE = 16;
const VERTEX_MATERIAL_INFO_SIZE = 32;
const SHADER_MATERIAL_HEADER_SIZE = 37;
const TEXTURE_CLAMP_U = 0x0008;
const TEXTURE_CLAMP_V = 0x0010;
const FX_TEXTURE = 1;
const FX_FLOAT = 2;
const FX_LAST_VECTOR = 5;
const FX_INT = 6;
const FX_BOOL = 7;

const readShader = (entry: Uint8Array): W3dShader => ({
  depthCompare: entry[0],
  depthMask: entry[1],
  destBlend: entry[3],
  primaryGradient: entry[5],
  srcBlend: entry[7],
  texturing: entry[8],
  detailColor: entry[9],
  detailAlpha: entry[10],
  alphaTest: entry[12],
});

const readRgb = (bytes: Uint8Array, at: number): Rgb => [
  bytes[at] / 255,
  bytes[at + 1] / 255,
  bytes[at + 2] / 255,
];

const readText = (bytes: Uint8Array) => readName(bytes, 0, bytes.length);

const readVertexMaterial = (payload: Uint8Array): W3dVertexMaterial | undefined => {
  let material: W3dVertexMaterial | undefined;
  let mapperArgs0: string | undefined;
  let mapperArgs1: string | undefined;

  for (const { type, payload: part } of readChunks(payload)) {
    if (type === CHUNK.VERTEX_MATERIAL_INFO && part.length >= VERTEX_MATERIAL_INFO_SIZE) {
      const view = createView(part);

      material = {
        attributes: view.getUint32(0, true),
        ambient: readRgb(part, 4),
        diffuse: readRgb(part, 8),
        emissive: readRgb(part, 16),
        opacity: view.getFloat32(24, true),
      };
    } else if (type === CHUNK.VERTEX_MAPPER_ARGS0) {
      mapperArgs0 = readText(part);
    } else if (type === CHUNK.VERTEX_MAPPER_ARGS1) {
      mapperArgs1 = readText(part);
    }
  }

  return material && { ...material, mapperArgs0, mapperArgs1 };
};

const readTexture = (payload: Uint8Array): W3dTexture | undefined => {
  const parts = readChunks(payload);
  const name = parts.find((part) => part.type === CHUNK.TEXTURE_NAME);
  const info = parts.find((part) => part.type === CHUNK.TEXTURE_INFO);
  const attributes =
    info && info.payload.length >= 2 ? createView(info.payload).getUint16(0, true) : 0;

  return (
    name && {
      name: readText(name.payload),
      clampU: (attributes & TEXTURE_CLAMP_U) !== 0,
      clampV: (attributes & TEXTURE_CLAMP_V) !== 0,
    }
  );
};

/** Reads one named parameter; a value cut short or of an unknown type is left out */
const readFxProperty = (
  payload: Uint8Array,
): [name: string, value: W3dFxValue] | undefined => {
  if (payload.length < 8) {
    return undefined;
  }

  const view = createView(payload);
  const type = view.getUint32(0, true);
  const nameLength = view.getUint32(4, true);
  const at = 8 + nameLength;
  const name = readName(payload, 8, nameLength).toLowerCase();
  const left = payload.length - at;

  if (type === FX_TEXTURE && left >= 4) {
    return [name, readName(payload, at + 4, view.getUint32(at, true))];
  }
  if (type === FX_FLOAT && left >= 4) {
    return [name, view.getFloat32(at, true)];
  }
  if (type > FX_FLOAT && type <= FX_LAST_VECTOR && left >= (type - 1) * 4) {
    return [
      name,
      Array.from({ length: type - 1 }, (_, index) =>
        view.getFloat32(at + index * 4, true),
      ),
    ];
  }
  if (type === FX_INT && left >= 4) {
    return [name, view.getUint32(at, true)];
  }
  if (type === FX_BOOL && left >= 1) {
    return [name, payload[at] !== 0];
  }
  return undefined;
};

const readFxMaterial = (payload: Uint8Array): W3dFxMaterial => {
  let shaderName = "";
  const properties = new Map<string, W3dFxValue>();

  for (const { type, payload: part } of readChunks(payload)) {
    if (type === CHUNK.SHADER_MATERIAL_HEADER && part.length >= SHADER_MATERIAL_HEADER_SIZE) {
      shaderName = readName(part, 1, 32);
    } else if (type === CHUNK.SHADER_MATERIAL_PROPERTY) {
      const property = readFxProperty(part);

      if (property) {
        properties.set(...property);
      }
    }
  }

  return { shaderName, properties };
};

const readStage = (payload: Uint8Array): W3dTextureStage => {
  const stage: W3dTextureStage = { textureIds: [] };

  for (const { type, payload: part } of readChunks(payload)) {
    if (type === CHUNK.TEXTURE_IDS) {
      stage.textureIds = readIds(part);
    } else if (type === CHUNK.STAGE_TEXCOORDS) {
      stage.uvs = readFloats(part);
    }
  }

  return stage;
};

const readPass = (payload: Uint8Array): W3dMaterialPass => {
  const pass: W3dMaterialPass = {
    vertexMaterialIds: [],
    shaderIds: [],
    fxMaterialIds: [],
    stages: [],
  };

  for (const { type, payload: part } of readChunks(payload)) {
    if (type === CHUNK.VERTEX_MATERIAL_IDS) {
      pass.vertexMaterialIds = readIds(part);
    } else if (type === CHUNK.SHADER_IDS) {
      pass.shaderIds = readIds(part);
    } else if (type === CHUNK.SHADER_MATERIAL_ID) {
      pass.fxMaterialIds = readIds(part);
    } else if (type === CHUNK.DCG) {
      // Copied so a message carries these bytes alone, not the file they sit in
      pass.colors = part.slice();
    } else if (type === CHUNK.STAGE_TEXCOORDS) {
      pass.uvs = readFloats(part);
    } else if (type === CHUNK.TEXTURE_STAGE) {
      pass.stages.push(readStage(part));
    }
  }

  return pass;
};

/** Collects what each of a table chunk's entries of `type` reads to, skipping what reads to nothing */
const readEntries = <T>(
  payload: Uint8Array,
  type: number,
  read: (entry: Uint8Array) => T | undefined,
): T[] =>
  readChunks(payload).flatMap((entry) => {
    const value = entry.type === type ? read(entry.payload) : undefined;

    return value === undefined ? [] : [value];
  });

/** Reads the material tables from the chunks of a mesh */
export const readMeshMaterials = (
  chunks: readonly { type: number; payload: Uint8Array }[],
): W3dMeshMaterials => {
  const materials: W3dMeshMaterials = {
    shaders: [],
    vertexMaterials: [],
    textures: [],
    fxMaterials: [],
    passes: [],
  };

  for (const { type, payload } of chunks) {
    if (type === CHUNK.SHADERS) {
      for (let at = 0; at + SHADER_SIZE <= payload.length; at += SHADER_SIZE) {
        materials.shaders.push(readShader(payload.subarray(at, at + SHADER_SIZE)));
      }
    } else if (type === CHUNK.VERTEX_MATERIALS) {
      materials.vertexMaterials = readChunks(payload)
        .filter((entry) => entry.type === CHUNK.VERTEX_MATERIAL)
        .map((entry) => readVertexMaterial(entry.payload) ?? NO_INFO);
    } else if (type === CHUNK.TEXTURES) {
      materials.textures = readEntries(payload, CHUNK.TEXTURE, readTexture);
    } else if (type === CHUNK.SHADER_MATERIALS) {
      materials.fxMaterials = readEntries(payload, CHUNK.SHADER_MATERIAL, readFxMaterial);
    } else if (type === CHUNK.MATERIAL_PASS) {
      materials.passes.push(readPass(payload));
    }
  }

  return materials;
};
