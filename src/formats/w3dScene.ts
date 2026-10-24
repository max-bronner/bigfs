import type { ToolBox } from '../tools/toolRegistry';
import { decodeDdsTool, decodeTgaTool } from '../tools/textureTools';
import type { RgbaImage } from '../tools/textureTools';
import { parseW3dTool } from '../tools/w3dTools';
import type { W3dFile, W3dHierarchy, W3dMesh } from '../tools/w3dTools';
import { parseW3dAnimations } from './w3dAnimation';
import type { W3dAnimation } from './w3dAnimation';

/**
 * Builds what a model preview draws from a W3D file: every mesh in model
 * space, placed on the bone its HLOD names (or, for a skin, each vertex on
 * its own bone), with its texture decoded.
 *
 * A model's skeleton and textures usually live in other entries, often in
 * other archives: the HLOD names `GUArcher_SKL`, found as `guarcher_skl.w3d`,
 * and a mesh names `GUArcher.tga`, which the game loads as `guarcher.dds`
 * when there is one. `loadFile` finds an entry by file name wherever it is.
 */

/** One mesh ready to draw: positions and normals in model space */
export interface SceneMesh {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices: Uint32Array;
  /** Index into `ModelScene.textures`, when the texture was found */
  texture?: number;
  /**
   * The mesh as stored, in the space of the bones its vertices follow, so a
   * player can pose it: absent when no vertex follows a bone
   */
  local?: {
    positions: Float32Array;
    normals?: Float32Array;
    /** Bone of each vertex */
    bones: Uint16Array;
  };
}

/** A skeleton in its bind pose, for posing a model */
export interface SceneSkeleton {
  name: string;
  names: string[];
  parents: number[];
  /** Three a bone */
  translations: number[];
  /** Four a bone, as x, y, z, w */
  rotations: number[];
}

/** A model ready to draw */
export interface ModelScene {
  meshes: SceneMesh[];
  textures: RgbaImage[];
  /** Texture names no archive or folder holds, which a preview reports */
  missing: string[];
  /** Name of the skeleton, when the model has one */
  hierarchy?: string;
  skeleton?: SceneSkeleton;
  /** An animation the file itself holds, which plays at once */
  animation?: W3dAnimation;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Finds an entry by file name, matched without casing, wherever it lives */
export type LoadFile = (fileName: string) => Promise<Uint8Array | undefined>;

/** A 4x4 matrix, column major */
type Matrix = Float64Array;

const multiply = (a: Matrix, b: Matrix): Matrix => {
  const out = new Float64Array(16);

  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;

      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }

      out[column * 4 + row] = sum;
    }
  }

  return out;
};

/** A bone's transform relative to its parent: rotate, then translate */
const pivotMatrix = (
  [tx, ty, tz]: [number, number, number],
  [x, y, z, w]: [number, number, number, number],
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

/** Every bone's transform in model space, parents before children */
const boneMatrices = (hierarchy: W3dHierarchy | undefined): Matrix[] => {
  const matrices: Matrix[] = [];

  hierarchy?.pivots.forEach((pivot, index) => {
    const local = pivotMatrix(pivot.translation, pivot.rotation);
    const parent =
      pivot.parent >= 0 && pivot.parent < index
        ? matrices[pivot.parent]
        : undefined;

    matrices.push(parent ? multiply(parent, local) : local);
  });

  return matrices;
};

/** Applies a matrix to each three-component vector, as a point or a direction */
const transform = (
  values: Float32Array,
  matrixOf: (vertex: number) => Matrix | undefined,
  isPoint: boolean,
): Float32Array => {
  const out = new Float32Array(values.length);

  for (let vertex = 0; vertex < values.length / 3; vertex++) {
    const m = matrixOf(vertex);
    const [x, y, z] = values.subarray(vertex * 3, vertex * 3 + 3);

    if (!m) {
      out.set([x, y, z], vertex * 3);
      continue;
    }

    const w = isPoint ? 1 : 0;

    out[vertex * 3] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[vertex * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[vertex * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  }

  return out;
};

/** The file name without its extension */
const stem = (fileName: string): string => fileName.replace(/\.[^.]*$/, '');

/** Finds and decodes a texture, preferring a DDS over the TGA a mesh names */
const loadTexture = async (
  name: string,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<RgbaImage | undefined> => {
  for (const [extension, tool] of [
    ['.dds', decodeDdsTool],
    ['.tga', decodeTgaTool],
  ] as const) {
    const bytes = await loadFile(`${stem(name)}${extension}`);

    if (bytes) {
      try {
        return (await tools.use(tool)(bytes)).levels[0];
      } catch {
        // A texture that does not decode draws untextured, like a missing one
      }
    }
  }

  return undefined;
};

/** The bone each vertex of a mesh follows, or one bone for the whole mesh */
const vertexBones = (
  mesh: W3dMesh,
  file: W3dFile,
): ((vertex: number) => number | undefined) => {
  if (mesh.isSkin && mesh.bones) {
    const bones = mesh.bones;

    return (vertex) => bones[vertex];
  }

  const fullName = `${mesh.container}.${mesh.name}`.toLowerCase();
  const subObject = file.hlod?.subObjects.find(
    (candidate) => candidate.name.toLowerCase() === fullName,
  );

  return () => subObject?.bone;
};

/** Builds the scene for a W3D file, loading its skeleton and textures */
export const buildW3dScene = async (
  bytes: Uint8Array,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<ModelScene> => {
  const parse = tools.use(parseW3dTool);
  const file = await parse(bytes);
  const [animation] = parseW3dAnimations(bytes);

  // A skeleton is usually its own file, named by the HLOD or the animation
  let hierarchy = file.hierarchy;
  const hierarchyName = file.hlod?.hierarchyName ?? animation?.hierarchyName;

  if (!hierarchy && hierarchyName) {
    const skeleton = await loadFile(`${hierarchyName}.w3d`);

    hierarchy = skeleton ? (await parse(skeleton)).hierarchy : undefined;
  }

  if (!file.meshes.length && !hierarchy) {
    throw new Error(
      animation
        ? `This is the animation ${animation.name}; its skeleton ${animation.hierarchyName} was not found`
        : 'This W3D file has no meshes',
    );
  }

  const matrices = boneMatrices(hierarchy);
  const textureNames = [
    ...new Set(
      file.meshes.flatMap((mesh) => (mesh.texture ? [mesh.texture] : [])),
    ),
  ];
  const decoded = await Promise.all(
    textureNames.map((name) => loadTexture(name, loadFile, tools)),
  );
  const textures: RgbaImage[] = [];
  const textureIndex = new Map<string, number>();

  textureNames.forEach((name, index) => {
    const image = decoded[index];

    if (image) {
      textureIndex.set(name, textures.length);
      textures.push(image);
    }
  });

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const meshes = file.meshes.map((mesh): SceneMesh => {
    const boneOf = vertexBones(mesh, file);
    const matrixOf = (vertex: number) => {
      const bone = boneOf(vertex);

      return bone === undefined ? undefined : matrices[bone];
    };
    const positions = transform(mesh.positions, matrixOf, true);

    for (let at = 0; at < positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], positions[at + axis]);
        max[axis] = Math.max(max[axis], positions[at + axis]);
      }
    }

    const vertexCount = mesh.positions.length / 3;
    const bones = new Uint16Array(vertexCount);
    let isBound = false;

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const bone = boneOf(vertex);

      if (bone !== undefined && bone < matrices.length) {
        bones[vertex] = bone;
        isBound = true;
      }
    }

    return {
      name: mesh.name,
      positions,
      normals: mesh.normals && transform(mesh.normals, matrixOf, false),
      uvs: mesh.uvs,
      indices: mesh.indices,
      texture: mesh.texture ? textureIndex.get(mesh.texture) : undefined,
      local: isBound
        ? { positions: mesh.positions, normals: mesh.normals, bones }
        : undefined,
    };
  });

  // A skeleton alone is framed by its bones
  if (!meshes.length) {
    for (const matrix of matrices) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], matrix[12 + axis]);
        max[axis] = Math.max(max[axis], matrix[12 + axis]);
      }
    }
  }

  return {
    meshes,
    textures,
    missing: textureNames.filter((name) => !textureIndex.has(name)),
    hierarchy: hierarchy?.name,
    skeleton: hierarchy && {
      name: hierarchy.name,
      names: hierarchy.pivots.map((pivot) => pivot.name),
      parents: hierarchy.pivots.map((pivot) => pivot.parent),
      translations: hierarchy.pivots.flatMap((pivot) => pivot.translation),
      rotations: hierarchy.pivots.flatMap((pivot) => pivot.rotation),
    },
    animation,
    bounds: { min, max },
  };
};
