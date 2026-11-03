import type { Tool } from "../../core/toolRegistry";
import { createView, readChunks, readFloats, readName } from "./w3dChunks";
import { readMeshMaterials } from "./w3dMaterialChunks";
import { pickMeshBlend } from "./pickMeshBlend";
import { resolveMaterialDraws } from "./resolveMaterialDraws";
import type { W3dBlend, W3dMaterialDraw } from "./w3dMaterialTypes";

/**
 * Parser for the parts of a W3D model a preview draws: meshes with their
 * vertices, normals, triangles, texture coordinates and texture names, the
 * bone hierarchy, the HLOD that places each mesh on a bone (every level of
 * detail, with its aggregate and proxy lists), and the collision boxes.
 *
 * A W3D file is a tree of chunks (`w3dChunks.ts`), and a chunk this parser
 * does not read is skipped. Layouts are EA's `w3d_file.h`, with the vertex
 * influence as BFME stores it (two bones and two weights), which mint's
 * research confirmed.
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
  /**
   * Two per vertex, as stored: V measured from the bottom. The first
   * pass's first stage, else the first pass's own
   */
  uvs?: Float32Array;
  indices: Uint32Array;
  /** The two bones of each vertex, two a vertex, for a skin */
  bones?: Uint16Array;
  /** The percentage each of those bones takes, two a vertex, as stored */
  weights?: Uint16Array;
  /** `VERTICES_2`: each vertex again, in its second bone's space */
  secondPositions?: Float32Array;
  /** `VERTEX_NORMALS_2`: each normal in its second bone's space; zero where the file ends early */
  secondNormals?: Float32Array;
  /**
   * `W3D_MESH_FLAG_HIDDEN`: the mesh starts out hidden and is not drawn until
   * something turns it on, though its HLOD still lists it
   */
  hidden: boolean;
  /** Texture of the first stage, when the mesh has one */
  texture?: string;
  /** Whether the drawn material cuts out where the texture's alpha is low */
  alphaTest: boolean;
  /** How the drawn material meets what is behind it */
  blend: W3dBlend;
  /** The mesh's name says it is a picking proxy, which is never drawn */
  pickProxy: boolean;
  /** The material passes as draws, a pass's triangles split by what they draw with */
  draws: W3dMaterialDraw[];
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

/** One level of detail, or the aggregate or proxy list of an HLOD */
export interface W3dHlodArray {
  /**
   * Screen size above which the game switches to a finer level; the finest
   * level stores the largest float, meaning never
   */
  maxScreenSize: number;
  subObjects: W3dSubObject[];
}

/** What a model's HLOD records: its skeleton and the mesh on each bone */
export interface W3dHlod {
  name: string;
  hierarchyName: string;
  /** The most detailed level of detail only */
  subObjects: W3dSubObject[];
  /**
   * The levels of detail the game reads, coarsest first as written: exactly
   * the header's count of arrays, in file order, so the last of these is the
   * finest. A retail file counts one, however many arrays it holds.
   */
  lods: W3dHlodArray[];
  /** LOD arrays stored past the header's count, which the game never reads */
  skippedLodCount: number;
  /** Other models the game attaches to bones */
  aggregates?: W3dHlodArray;
  /** Named bone transforms game logic places objects at */
  proxies?: W3dHlodArray;
}

/** A collision box (`BOX` chunk) */
export interface W3dBox {
  /** `CONTAINER.NAME`, the name an HLOD sub-object uses to place it */
  name: string;
  /** Whether the box turns with its bone (else it keeps the model's axes) */
  oriented: boolean;
  /** Centre, in the space of the bone it rides on */
  center: [number, number, number];
  /** Half the size along each axis */
  extent: [number, number, number];
}

/** Everything read from one W3D file */
export interface W3dFile {
  meshes: W3dMesh[];
  boxes: W3dBox[];
  hierarchy?: W3dHierarchy;
  hlod?: W3dHlod;
}

const CHUNK = {
  MESH: 0x000,
  VERTICES: 0x002,
  VERTEX_NORMALS: 0x003,
  VERTEX_INFLUENCES: 0x00e,
  VERTICES_2: 0xc00,
  VERTEX_NORMALS_2: 0xc01,
  MESH_HEADER3: 0x01f,
  TRIANGLES: 0x020,
  HIERARCHY: 0x100,
  HIERARCHY_HEADER: 0x101,
  PIVOTS: 0x102,
  HLOD: 0x700,
  HLOD_HEADER: 0x701,
  HLOD_LOD_ARRAY: 0x702,
  HLOD_SUB_OBJECT_ARRAY_HEADER: 0x703,
  HLOD_SUB_OBJECT: 0x704,
  HLOD_AGGREGATE_ARRAY: 0x705,
  HLOD_PROXY_ARRAY: 0x706,
  BOX: 0x740,
};

const GEOMETRY_TYPE_MASK = 0x00ff0000;
const GEOMETRY_TYPE_SKIN = 0x00020000;
const MESH_FLAG_HIDDEN = 0x00001000;
const MESH_FLAG_TWO_SIDED = 0x00002000;
const MESH_HEADER_SORT_LEVEL = 56;
const BOX_ATTRIBUTE_ORIENTED = 0x1;
const BOX_SIZE = 68;
const HLOD_ARRAY_HEADER_SIZE = 8;
const HLOD_SUB_OBJECT_SIZE = 36;

/** Copies the values into an array of `length`, cut short or zero filled */
const padTo = (values: Float32Array | undefined, length: number) => {
  const out = new Float32Array(length);

  out.set(values?.subarray(0, length) ?? []);

  return out;
};

/** Whether a mesh's name marks it as a stand-in for mouse picking: mint's `is_pick_proxy` */
const isPickProxy = (name: string) => name.slice(0, 4).toUpperCase() === "PICK";

const readMesh = (payload: Uint8Array): W3dMesh | undefined => {
  let header: Uint8Array | undefined;
  let positions: Float32Array | undefined;
  let normals: Float32Array | undefined;
  let indices: Uint32Array | undefined;
  let bones: Uint16Array | undefined;
  let weights: Uint16Array | undefined;
  let secondPositions: Float32Array | undefined;
  let secondNormals: Float32Array | undefined;
  const chunks = readChunks(payload);

  for (const chunk of chunks) {
    const view = createView(chunk.payload);

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

        bones = new Uint16Array(count * 2);
        weights = new Uint16Array(count * 2);

        for (let index = 0; index < count * 2; index++) {
          bones[index] = view.getUint16(index * 2 + (index >> 1) * 4, true);
          weights[index] = view.getUint16(index * 2 + 4 + (index >> 1) * 4, true);
        }
        break;
      }
      case CHUNK.VERTICES_2:
        secondPositions = readFloats(chunk.payload);
        break;
      case CHUNK.VERTEX_NORMALS_2:
        secondNormals = readFloats(chunk.payload);
        break;
    }
  }

  if (!header || header.length < 116 || !positions || !indices) {
    return undefined;
  }

  const vertexCount = positions.length / 3;
  const hasInfluences = bones?.length === vertexCount * 2;
  // A short or missing second copy drops the copy, as mint's `second_bone_space`
  const hasSecondCopy =
    hasInfluences && vertexCount > 0 && secondPositions?.length === positions.length;
  // An index past the vertices would draw from memory that is not the mesh
  if (indices.some((index) => index >= vertexCount)) {
    throw new Error(
      `W3D mesh ${readName(header, 8, 16)} indexes past its vertices`,
    );
  }

  const attributes = createView(header).getUint32(4, true);
  const name = readName(header, 8, 16);
  const draws = resolveMaterialDraws(readMeshMaterials(chunks), {
    indices,
    vertexCount,
    twoSided: (attributes & MESH_FLAG_TWO_SIDED) !== 0,
    sortLevel: createView(header).getInt32(MESH_HEADER_SORT_LEVEL, true),
  });
  // A single-pass renderer's view of the mesh: its first pass
  const firstPass = draws.filter((draw) => draw.pass === 0);

  return {
    name,
    container: readName(header, 24, 16),
    isSkin: (attributes & GEOMETRY_TYPE_MASK) === GEOMETRY_TYPE_SKIN,
    hidden: (attributes & MESH_FLAG_HIDDEN) !== 0,
    positions,
    normals: normals?.length === positions.length ? normals : undefined,
    uvs: firstPass[0]?.uvs,
    indices,
    bones: hasInfluences ? bones : undefined,
    weights: hasInfluences ? weights : undefined,
    secondPositions: hasSecondCopy ? secondPositions : undefined,
    secondNormals: hasSecondCopy
      ? padTo(secondNormals, positions.length)
      : undefined,
    texture: firstPass.find((draw) => draw.texture)?.texture?.name,
    alphaTest: firstPass.some((draw) => draw.surface.alphaTest),
    blend: pickMeshBlend(firstPass.map((draw) => draw.surface)),
    pickProxy: isPickProxy(name),
    draws,
  };
};

const readHierarchy = (payload: Uint8Array): W3dHierarchy | undefined => {
  let name = "";
  const pivots: W3dPivot[] = [];

  for (const chunk of readChunks(payload)) {
    if (chunk.type === CHUNK.HIERARCHY_HEADER && chunk.payload.length >= 36) {
      name = readName(chunk.payload, 4, 16);
    }

    if (chunk.type === CHUNK.PIVOTS) {
      const view = createView(chunk.payload);

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

/** Reads one LOD, aggregate or proxy array: a header, then its sub-objects */
const readHlodArray = (payload: Uint8Array): W3dHlodArray => {
  let maxScreenSize = 0;
  const subObjects: W3dSubObject[] = [];

  for (const chunk of readChunks(payload)) {
    if (chunk.type === CHUNK.HLOD_SUB_OBJECT_ARRAY_HEADER) {
      if (chunk.payload.length < HLOD_ARRAY_HEADER_SIZE) {
        throw new Error(
          `W3D HLOD array header is ${chunk.payload.length} bytes, expected ${HLOD_ARRAY_HEADER_SIZE}`,
        );
      }
      maxScreenSize = createView(chunk.payload).getFloat32(4, true);
    } else if (chunk.type === CHUNK.HLOD_SUB_OBJECT) {
      if (chunk.payload.length < HLOD_SUB_OBJECT_SIZE) {
        throw new Error(
          `W3D HLOD sub-object is ${chunk.payload.length} bytes, expected ${HLOD_SUB_OBJECT_SIZE}`,
        );
      }
      subObjects.push({
        bone: createView(chunk.payload).getUint32(0, true),
        name: readName(chunk.payload, 4, 32),
      });
    }
  }

  return { maxScreenSize, subObjects };
};

const readHlod = (payload: Uint8Array): W3dHlod | undefined => {
  let header: Uint8Array | undefined;
  const arrays: W3dHlodArray[] = [];
  let aggregates: W3dHlodArray | undefined;
  let proxies: W3dHlodArray | undefined;

  for (const chunk of readChunks(payload)) {
    if (chunk.type === CHUNK.HLOD_HEADER) {
      header = chunk.payload;
    } else if (chunk.type === CHUNK.HLOD_LOD_ARRAY) {
      arrays.push(readHlodArray(chunk.payload));
    } else if (chunk.type === CHUNK.HLOD_AGGREGATE_ARRAY) {
      aggregates = readHlodArray(chunk.payload);
    } else if (chunk.type === CHUNK.HLOD_PROXY_ARRAY) {
      proxies = readHlodArray(chunk.payload);
    }
  }

  if (!header || header.length < 40) {
    return undefined;
  }

  const lodCount = createView(header).getUint32(4, true);
  const lods = arrays.slice(0, lodCount);

  return {
    name: readName(header, 8, 16),
    hierarchyName: readName(header, 24, 16),
    subObjects: lods.at(-1)?.subObjects ?? [],
    lods,
    skippedLodCount: arrays.length - lods.length,
    aggregates,
    proxies,
  };
};

/**
 * Reads a `BOX` chunk: version, attributes, name, colour, centre and extent
 * (EA's `W3dBoxStruct`, 68 bytes; the layout is from `w3d_file.h`, the
 * extent being the half-size as in `OBBoxClass`)
 */
const readBox = (payload: Uint8Array): W3dBox => {
  if (payload.length < BOX_SIZE) {
    throw new Error(
      `W3D BOX chunk is ${payload.length} bytes, expected ${BOX_SIZE}`,
    );
  }

  const view = createView(payload);
  const float = (offset: number) => view.getFloat32(offset, true);

  return {
    name: readName(payload, 8, 32),
    oriented: (view.getUint32(4, true) & BOX_ATTRIBUTE_ORIENTED) !== 0,
    center: [float(44), float(48), float(52)],
    extent: [float(56), float(60), float(64)],
  };
};

/**
 * Reads the meshes, collision boxes, hierarchy and HLOD of a W3D file.
 * Throws when a chunk overruns its parent or a mesh indexes past its vertices.
 */
export const parseW3d = (bytes: Uint8Array): W3dFile => {
  const file: W3dFile = { meshes: [], boxes: [] };

  for (const chunk of readChunks(bytes)) {
    switch (chunk.type) {
      case CHUNK.MESH: {
        const mesh = readMesh(chunk.payload);

        if (mesh) {
          file.meshes.push(mesh);
        }

        break;
      }
      case CHUNK.BOX:
        file.boxes.push(readBox(chunk.payload));
        break;
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

/** Registered tool that parses a W3D entry into a `W3dFile` */
export const parseW3dTool: Tool<Uint8Array, W3dFile> = {
  id: "model.parseW3d",
  run: parseW3d,
};
