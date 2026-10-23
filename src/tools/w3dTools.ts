import type { Tool } from './toolRegistry';

/**
 * Parser for the parts of a W3D model a preview draws: meshes with their
 * vertices, normals, triangles, texture coordinates and texture names, the
 * bone hierarchy, and the HLOD that places each mesh on a bone.
 *
 * A W3D file is a tree of chunks, each an 8-byte header (a type, and a size
 * whose top bit marks a chunk that holds chunks) and a payload. Every size is
 * checked against the bytes present, and a chunk this parser does not read is
 * skipped. Layouts are EA's `w3d_file.h`, with the vertex influence as BFME
 * stores it (two bones and two weights), which mint's research confirmed.
 */

/** One mesh as stored, in its own space */
export interface W3dMesh {
  name: string;
  /** The model the mesh belongs to; an HLOD names it as `CONTAINER.MESH` */
  container: string;
  /** Whether vertices are stored in the space of the bones they follow */
  isSkin: boolean;
  positions: Float32Array;
  normals?: Float32Array;
  /** Two per vertex, from the first texture stage */
  uvs?: Float32Array;
  indices: Uint32Array;
  /** The bone each vertex follows, for a skin */
  bones?: Uint16Array;
  /** Texture of the first stage, when the mesh has one */
  texture?: string;
}

/** One bone, relative to its parent */
export interface W3dPivot {
  name: string;
  /** Index of the parent bone, or -1 for a root */
  parent: number;
  translation: [number, number, number];
  /** Quaternion as x, y, z, w */
  rotation: [number, number, number, number];
}

/** A bone hierarchy, which a skeleton file holds on its own */
export interface W3dHierarchy {
  name: string;
  pivots: W3dPivot[];
}

/** Where an HLOD puts one mesh: on which bone */
export interface W3dSubObject {
  /** `CONTAINER.MESH` */
  name: string;
  bone: number;
}

/** What a model's HLOD records: its skeleton and the mesh on each bone */
export interface W3dHlod {
  name: string;
  hierarchyName: string;
  /** The most detailed level of detail only, which is the one shown */
  subObjects: W3dSubObject[];
}

/** Everything read from one W3D file */
export interface W3dFile {
  meshes: W3dMesh[];
  hierarchy?: W3dHierarchy;
  hlod?: W3dHlod;
}

const CHUNK = {
  MESH: 0x000,
  VERTICES: 0x002,
  VERTEX_NORMALS: 0x003,
  VERTEX_INFLUENCES: 0x00e,
  MESH_HEADER3: 0x01f,
  TRIANGLES: 0x020,
  TEXTURES: 0x030,
  TEXTURE: 0x031,
  TEXTURE_NAME: 0x032,
  MATERIAL_PASS: 0x038,
  TEXTURE_STAGE: 0x048,
  STAGE_TEXCOORDS: 0x04a,
  SHADER_MATERIALS: 0x050,
  SHADER_MATERIAL: 0x051,
  SHADER_MATERIAL_PROPERTY: 0x053,
  HIERARCHY: 0x100,
  HIERARCHY_HEADER: 0x101,
  PIVOTS: 0x102,
  HLOD: 0x700,
  HLOD_HEADER: 0x701,
  HLOD_LOD_ARRAY: 0x702,
  HLOD_SUB_OBJECT: 0x704,
};

const GEOMETRY_TYPE_MASK = 0x00ff0000;
const GEOMETRY_TYPE_SKIN = 0x00020000;

/** A chunk's type and payload */
interface Chunk {
  type: number;
  payload: Uint8Array;
}

/** Splits a run of bytes into the chunks it holds, refusing any that overrun it */
const readChunks = (bytes: Uint8Array): Chunk[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let cursor = 0;

  while (cursor + 8 <= bytes.length) {
    const type = view.getUint32(cursor, true);
    // The top bit marks a chunk that holds chunks, which the reader of each
    // type already knows
    const size = view.getUint32(cursor + 4, true) & 0x7fffffff;
    const start = cursor + 8;

    if (start + size > bytes.length) {
      throw new Error(
        `W3D chunk 0x${type.toString(16)} at ${cursor} runs past the data holding it`,
      );
    }

    chunks.push({ type, payload: bytes.subarray(start, start + size) });
    cursor = start + size;
  }

  return chunks;
};

const viewOf = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A fixed-length, NUL-padded name */
const readName = (bytes: Uint8Array, at: number, length: number): string => {
  const slice = bytes.subarray(at, Math.min(at + length, bytes.length));
  const end = slice.indexOf(0);

  return String.fromCharCode(...(end < 0 ? slice : slice.subarray(0, end)));
};

/** The floats a payload holds, copied so the result owns its memory */
const readFloats = (bytes: Uint8Array): Float32Array => {
  const view = viewOf(bytes);
  const floats = new Float32Array(Math.floor(bytes.length / 4));

  floats.forEach((_, index) => {
    floats[index] = view.getFloat32(index * 4, true);
  });

  return floats;
};

/** The texture a shader material binds to its first stage */
const readShaderTexture = (material: Uint8Array): string | undefined => {
  let fallback: string | undefined;

  for (const property of readChunks(material)) {
    if (property.type !== CHUNK.SHADER_MATERIAL_PROPERTY) {
      continue;
    }

    const view = viewOf(property.payload);

    if (property.payload.length < 12 || view.getUint32(0, true) !== 1) {
      continue;
    }

    const nameLength = view.getUint32(4, true);
    const name = readName(property.payload, 8, nameLength);
    const valueAt = 8 + nameLength;

    if (valueAt + 4 > property.payload.length) {
      continue;
    }

    const value = readName(
      property.payload,
      valueAt + 4,
      view.getUint32(valueAt, true),
    );

    if (name === 'DiffuseTexture') {
      return value;
    }

    if (name === 'Texture_0') {
      fallback = value;
    }
  }

  return fallback;
};

const readMesh = (payload: Uint8Array): W3dMesh | undefined => {
  let header: Uint8Array | undefined;
  let positions: Float32Array | undefined;
  let normals: Float32Array | undefined;
  let uvs: Float32Array | undefined;
  let indices: Uint32Array | undefined;
  let bones: Uint16Array | undefined;
  const textures: string[] = [];
  let shaderTexture: string | undefined;

  for (const chunk of readChunks(payload)) {
    const view = viewOf(chunk.payload);

    switch (chunk.type) {
      case CHUNK.MESH_HEADER3:
        header = chunk.payload;
        break;
      case CHUNK.VERTICES:
        positions = readFloats(chunk.payload);
        break;
      case CHUNK.VERTEX_NORMALS:
        normals = readFloats(chunk.payload);
        break;
      case CHUNK.TRIANGLES: {
        const count = Math.floor(chunk.payload.length / 32);

        indices = new Uint32Array(count * 3);

        for (let triangle = 0; triangle < count; triangle++) {
          for (let corner = 0; corner < 3; corner++) {
            indices[triangle * 3 + corner] = view.getUint32(
              triangle * 32 + corner * 4,
              true,
            );
          }
        }

        break;
      }
      case CHUNK.VERTEX_INFLUENCES: {
        const count = Math.floor(chunk.payload.length / 8);

        bones = new Uint16Array(count);
        bones.forEach((_, index) => {
          bones![index] = view.getUint16(index * 8, true);
        });
        break;
      }
      case CHUNK.TEXTURES:
        for (const texture of readChunks(chunk.payload)) {
          const name = readChunks(texture.payload).find(
            (part) => part.type === CHUNK.TEXTURE_NAME,
          );

          if (texture.type === CHUNK.TEXTURE && name) {
            textures.push(readName(name.payload, 0, name.payload.length));
          }
        }
        break;
      case CHUNK.MATERIAL_PASS:
        // The first pass's first stage carries the coordinates drawn with
        for (const stage of readChunks(chunk.payload)) {
          const coordinates =
            stage.type === CHUNK.TEXTURE_STAGE
              ? readChunks(stage.payload).find(
                  (part) => part.type === CHUNK.STAGE_TEXCOORDS,
                )
              : undefined;

          if (coordinates && !uvs) {
            uvs = readFloats(coordinates.payload);
          }
        }
        break;
      case CHUNK.SHADER_MATERIALS:
        shaderTexture ??= readChunks(chunk.payload)
          .filter((material) => material.type === CHUNK.SHADER_MATERIAL)
          .map((material) => readShaderTexture(material.payload))
          .find(Boolean);
        break;
    }
  }

  if (!header || header.length < 116 || !positions || !indices) {
    return undefined;
  }

  const vertexCount = positions.length / 3;

  // An index past the vertices would draw from memory that is not the mesh
  if (indices.some((index) => index >= vertexCount)) {
    throw new Error(
      `W3D mesh ${readName(header, 8, 16)} indexes past its vertices`,
    );
  }

  return {
    name: readName(header, 8, 16),
    container: readName(header, 24, 16),
    isSkin:
      (viewOf(header).getUint32(4, true) & GEOMETRY_TYPE_MASK) ===
      GEOMETRY_TYPE_SKIN,
    positions,
    normals: normals?.length === positions.length ? normals : undefined,
    uvs: uvs?.length === vertexCount * 2 ? uvs : undefined,
    indices,
    bones: bones?.length === vertexCount ? bones : undefined,
    texture: shaderTexture ?? textures[0],
  };
};

const readHierarchy = (payload: Uint8Array): W3dHierarchy | undefined => {
  let name = '';
  const pivots: W3dPivot[] = [];

  for (const chunk of readChunks(payload)) {
    if (chunk.type === CHUNK.HIERARCHY_HEADER && chunk.payload.length >= 36) {
      name = readName(chunk.payload, 4, 16);
    }

    if (chunk.type === CHUNK.PIVOTS) {
      const view = viewOf(chunk.payload);

      for (let at = 0; at + 60 <= chunk.payload.length; at += 60) {
        const parent = view.getUint32(at + 16, true);
        const float = (offset: number) => view.getFloat32(at + offset, true);

        pivots.push({
          name: readName(chunk.payload, at, 16),
          parent: parent === 0xffffffff ? -1 : parent,
          translation: [float(20), float(24), float(28)],
          rotation: [float(44), float(48), float(52), float(56)],
        });
      }
    }
  }

  return pivots.length ? { name, pivots } : undefined;
};

const readHlod = (payload: Uint8Array): W3dHlod | undefined => {
  let header: Uint8Array | undefined;
  let lod: Uint8Array | undefined;

  for (const chunk of readChunks(payload)) {
    if (chunk.type === CHUNK.HLOD_HEADER) {
      header = chunk.payload;
    }

    // The last level of detail is the most detailed one
    if (chunk.type === CHUNK.HLOD_LOD_ARRAY) {
      lod = chunk.payload;
    }
  }

  if (!header || header.length < 40) {
    return undefined;
  }

  const subObjects = lod
    ? readChunks(lod)
        .filter(
          (chunk) =>
            chunk.type === CHUNK.HLOD_SUB_OBJECT && chunk.payload.length >= 36,
        )
        .map((chunk) => ({
          bone: viewOf(chunk.payload).getUint32(0, true),
          name: readName(chunk.payload, 4, 32),
        }))
    : [];

  return {
    name: readName(header, 8, 16),
    hierarchyName: readName(header, 24, 16),
    subObjects,
  };
};

/** Reads the meshes, hierarchy and HLOD of a W3D file */
export const parseW3d = (bytes: Uint8Array): W3dFile => {
  const file: W3dFile = { meshes: [] };

  for (const chunk of readChunks(bytes)) {
    switch (chunk.type) {
      case CHUNK.MESH: {
        const mesh = readMesh(chunk.payload);

        if (mesh) {
          file.meshes.push(mesh);
        }

        break;
      }
      case CHUNK.HIERARCHY:
        file.hierarchy ??= readHierarchy(chunk.payload);
        break;
      case CHUNK.HLOD:
        file.hlod ??= readHlod(chunk.payload);
        break;
    }
  }

  return file;
};

/** Tool that parses a W3D entry */
export const parseW3dTool: Tool<Uint8Array, W3dFile> = {
  id: 'model.parseW3d',
  run: parseW3d,
};
