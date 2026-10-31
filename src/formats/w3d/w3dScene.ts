import type { ToolBox } from "../../core/toolRegistry";
import { decodeDdsTool, decodeTgaTool } from "../texture/textureTools";
import type { RgbaImage } from "../texture/textureTools";
import { parseW3dTool } from "./w3dTools";
import type {
  W3dBlend,
  W3dBox,
  W3dFile,
  W3dHierarchy,
  W3dHlod,
  W3dMesh,
} from "./w3dTools";
import { parseW3dAnimations } from "./w3dAnimation";
import type { W3dAnimation } from "./w3dAnimation";
import { skinVertices, toBoneMatrix } from "./w3dSkin";
import type { BoneSpaceMesh, Matrix } from "./w3dSkin";

/**
 * Builds what a model preview draws from a W3D file: every mesh in model
 * space, placed on the bone its HLOD names (or, for a skin, each vertex on
 * its own one or two bones), with its texture decoded.
 *
 * A model's skeleton and textures usually live in other entries, often in
 * other archives: the HLOD names `GUArcher_SKL`, found as `guarcher_skl.w3d`,
 * and a mesh names `GUArcher.tga`, which the game loads as `guarcher.dds`
 * when there is one. `loadFile` finds an entry by file name wherever it is.
 */

/** One mesh ready to draw: positions and normals in model space */
export interface SceneMesh {
  name: string;
  /** The model the file says the mesh belongs to, the part before the `.` of its full name */
  container: string;
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices: Uint32Array;
  /** Index into `ModelScene.textures`, when the texture was found */
  texture?: number;
  /** Whether texels of low alpha are cut out */
  alphaTest: boolean;
  blend: W3dBlend;
  /** The mesh carries the HIDDEN attribute, so it is not drawn by default */
  hidden: boolean;
  /**
   * The mesh as stored, so a player can pose it: absent when no vertex
   * follows a bone
   */
  local?: BoneSpaceMesh;
  /** The bone a rigid mesh rides; a skin has none */
  bone?: number;
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

/** A collision box as twelve edges, in model space */
export interface SceneBox {
  name: string;
  /** Two endpoints an edge, three floats an endpoint */
  lines: Float32Array;
}

/** One HLOD level of detail: which meshes it draws */
export interface SceneLod {
  /** Screen size above which the game uses a finer level; absent for the finest */
  maxScreenSize?: number;
  /** Indices into `ModelScene.meshes` */
  meshes: number[];
}

/** The HLOD as the picker shows it */
export interface SceneHlod {
  name: string;
  /** The levels the game reads, coarsest first; the last is the finest. Nearly always one */
  lods: SceneLod[];
  /** LOD arrays the file holds past the header's count, unread by the game */
  skippedLodCount: number;
  /** Sub-object names of the aggregate list */
  aggregates: string[];
  /** Sub-object names of the proxy list */
  proxies: string[];
}

/** A model ready to draw */
export interface ModelScene {
  meshes: SceneMesh[];
  boxes: SceneBox[];
  hlod?: SceneHlod;
  textures: RgbaImage[];
  /** Texture names no archive or folder holds, which a preview reports */
  missing: string[];
  /** Name of the skeleton, when the model has one */
  hierarchy?: string;
  skeleton?: SceneSkeleton;
  /** An animation the file itself holds, which plays at once */
  animation?: W3dAnimation;
  /** The skeleton `animation` names, when it is not `skeleton` and was found */
  animationSkeleton?: SceneSkeleton;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Finds an entry by file name, matched without casing, wherever it lives */
export type LoadFile = (fileName: string) => Promise<Uint8Array | undefined>;

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

/** Computes every bone's matrix in model space, parents before children */
const computeBoneMatrices = (hierarchy: W3dHierarchy | undefined): Matrix[] => {
  const matrices: Matrix[] = [];

  hierarchy?.pivots.forEach((pivot, index) => {
    const local = toBoneMatrix(pivot.translation, pivot.rotation);
    const parent =
      pivot.parent >= 0 && pivot.parent < index
        ? matrices[pivot.parent]
        : undefined;

    matrices.push(parent ? multiply(parent, local) : local);
  });

  return matrices;
};

/**
 * Flips texture coordinates so V runs from the top, as WebGL samples an image
 * uploaded top row first. W3D measures V from the bottom (mint's
 * `convert::flip_v`, `w3d-format.md` "Texture coordinate origin"); the
 * textures are atlases, so without it each face samples another part of
 * the atlas rather than a mirrored picture.
 */
const flipV = (uvs: Float32Array): Float32Array =>
  uvs.map((value, index) => (index % 2 ? 1 - value : value));

/** Strips a file name's extension */
const removeExtension = (fileName: string): string => fileName.replace(/\.[^.]*$/, "");

/** Finds and decodes a texture, preferring a DDS over the TGA a mesh names */
const loadTexture = async (
  name: string,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<RgbaImage | undefined> => {
  for (const [extension, tool] of [
    [".dds", decodeDdsTool],
    [".tga", decodeTgaTool],
  ] as const) {
    const bytes = await loadFile(`${removeExtension(name)}${extension}`);

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

const formatSubObjectName = (container: string, name: string) =>
  `${container}.${name}`.toLowerCase();

/** Finds the sub-object naming a mesh or box, searching the finest level first */
const findSubObject = (file: W3dFile, container: string, name: string) => {
  const wanted = formatSubObjectName(container, name);

  for (const lod of [...(file.hlod?.lods ?? [])].reverse()) {
    const found = lod.subObjects.find(
      (candidate) => candidate.name.toLowerCase() === wanted,
    );

    if (found) {
      return found;
    }
  }

  return undefined;
};

/**
 * Scales stored percentages by 0.01, as the game builds its vertex buffer:
 * weights that do not sum to 100 stay as they are and pull the vertex towards
 * the origin, and two zeros put it there.
 */
const scaleWeights = (percentages: Uint16Array): Float32Array =>
  Float32Array.from(percentages, (percentage) => percentage * 0.01);

/**
 * Describes how a mesh rides its skeleton: a skin by each vertex's influences,
 * any other mesh wholly on the bone its HLOD names, or not at all. A skin
 * without one influence a vertex stays as stored, as mint leaves it.
 */
const bindToBones = (
  mesh: W3dMesh,
  file: W3dFile,
  boneCount: number,
): BoneSpaceMesh | undefined => {
  const { positions, normals, secondPositions, secondNormals } = mesh;

  if (mesh.isSkin) {
    return mesh.bones && mesh.weights && boneCount
      ? {
          positions,
          normals,
          bones: mesh.bones,
          weights: scaleWeights(mesh.weights),
          secondPositions,
          secondNormals,
        }
      : undefined;
  }

  const bone = findSubObject(file, mesh.container, mesh.name)?.bone;

  if (bone === undefined || bone >= boneCount) {
    return undefined;
  }

  const vertexCount = positions.length / 3;
  const bones = new Uint16Array(vertexCount * 2);
  const weights = new Float32Array(vertexCount * 2);

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    bones[vertex * 2] = bone;
    weights[vertex * 2] = 1;
  }

  return { positions, normals, bones, weights };
};

/** The corners of a box, each a sign on the three axes */
const CORNERS = [0, 1, 2, 3, 4, 5, 6, 7].map(
  (bits) => [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1] as const,
);

/**
 * Builds a box's twelve edges in model space. An oriented box turns with its bone;
 * an axis-aligned one is only carried to the bone's position.
 */
const buildBoxEdges = (box: W3dBox, bone: Matrix | undefined): Float32Array => {
  const corner = ([x, y, z]: readonly [number, number, number]) => {
    const local = [
      box.center[0] + (x ? box.extent[0] : -box.extent[0]),
      box.center[1] + (y ? box.extent[1] : -box.extent[1]),
      box.center[2] + (z ? box.extent[2] : -box.extent[2]),
    ];

    if (!bone) {
      return local;
    }

    const m = bone;

    if (!box.oriented) {
      return [local[0] + m[12], local[1] + m[13], local[2] + m[14]];
    }

    return [
      m[0] * local[0] + m[4] * local[1] + m[8] * local[2] + m[12],
      m[1] * local[0] + m[5] * local[1] + m[9] * local[2] + m[13],
      m[2] * local[0] + m[6] * local[1] + m[10] * local[2] + m[14],
    ];
  };
  const out: number[] = [];

  for (let from = 0; from < CORNERS.length; from++) {
    for (let to = from + 1; to < CORNERS.length; to++) {
      if (isEdgeAligned(from, to)) {
        out.push(...corner(CORNERS[from]), ...corner(CORNERS[to]));
      }
    }
  }

  return Float32Array.from(out);
};

/** Whether two corner indices differ in exactly one bit */
const isEdgeAligned = (a: number, b: number) => {
  const diff = a ^ b;

  return diff !== 0 && (diff & (diff - 1)) === 0;
};

const buildSceneHlod = (
  { name, lods, skippedLodCount, aggregates, proxies }: W3dHlod,
  meshes: W3dMesh[],
): SceneHlod => {
  const byName = new Map(
    meshes.map((mesh, at) => [formatSubObjectName(mesh.container, mesh.name), at]),
  );

  return {
    name,
    lods: lods.map((lod, at) => ({
      maxScreenSize: at === lods.length - 1 ? undefined : lod.maxScreenSize,
      meshes: lod.subObjects.flatMap((sub) => {
        const found = byName.get(sub.name.toLowerCase());

        return found === undefined ? [] : [found];
      }),
    })),
    skippedLodCount,
    aggregates: aggregates?.subObjects.map((sub) => sub.name) ?? [],
    proxies: proxies?.subObjects.map((sub) => sub.name) ?? [],
  };
};

/** One write to a model's sub-objects, as the game's INI and scripts make them */
export interface SubObjectRule {
  /** A mesh name, with or without its `CONTAINER.`; a final `*` matches every name it prefixes */
  pattern: string;
  hide: boolean;
  /** Where the write comes from, as the UI names it */
  source: string;
}

/** Options for `getMeshVisibility`: the level of detail and what hides or shows a mesh */
export interface VisibilityOptions {
  /** Index into `ModelScene.hlod.lods`; the finest when absent */
  lod?: number;
  /** Draws what the HIDDEN attribute and `subObjectRules` hide */
  showHidden?: boolean;
  /** Writes in the order the game applies them; the last one reaching a mesh decides */
  subObjectRules?: readonly SubObjectRule[];
  /** The user's choice by mesh index, which wins over everything but the level of detail */
  partOverrides?: ReadonlyMap<number, boolean>;
}

/**
 * Whether a rule's pattern names a mesh. As the game's lookup, it is compared
 * without casing to the mesh's full name and to the part after the `.`.
 */
export const isSubObjectNamed = (
  mesh: Pick<SceneMesh, "container" | "name">,
  pattern: string,
): boolean => {
  const full = formatSubObjectName(mesh.container, mesh.name);
  const names = [full, full.slice(full.lastIndexOf(".") + 1)];
  const wanted = pattern.toLowerCase();

  return wanted.endsWith("*")
    ? names.some((name) => name.startsWith(wanted.slice(0, -1)))
    : names.includes(wanted);
};

/** The reason a mesh with the HIDDEN attribute is not drawn, as the UI names it */
const HIDDEN_ATTRIBUTE = "the W3D HIDDEN flag";

/** Whether a bone sits somewhere below another; one that is not in `parents` is below nothing */
const isBoneBelow = (
  bone: number,
  ancestor: number,
  parents: readonly number[],
): boolean => {
  let at = bone;

  for (let step = 0; at > 0 && at < parents.length && step < parents.length; step++) {
    at = parents[at];
    if (at === ancestor) {
      return true;
    }
  }
  return false;
};

/** The meshes of `getMeshVisibility` and `findHidingSources` */
type VisibleMesh = Pick<SceneMesh, "container" | "name" | "hidden" | "bone">;

/**
 * Says, mesh by mesh, what hides it: the source of the last rule reaching it,
 * or the HIDDEN attribute when no rule does. A mesh left visible has no reason.
 * As in the game, a write reaches the meshes it names and every mesh on a bone
 * below theirs, unless the named mesh is on the root; a mesh on the same bone
 * is not reached, nor is a skin, whose bone is the root.
 * @param parents The skeleton's parent of each bone; without one nothing cascades
 */
export const findHidingSources = (
  meshes: readonly VisibleMesh[],
  rules: readonly SubObjectRule[] = [],
  parents: readonly number[] = [],
): (string | undefined)[] => {
  const sources = meshes.map((mesh): string | undefined =>
    mesh.hidden ? HIDDEN_ATTRIBUTE : undefined,
  );

  for (const rule of rules) {
    const source = rule.hide ? rule.source : undefined;

    meshes.forEach((mesh, at) => {
      if (!isSubObjectNamed(mesh, rule.pattern)) {
        return;
      }
      sources[at] = source;

      const { bone = 0 } = mesh;

      if (bone > 0) {
        meshes.forEach((other, below) => {
          if (isBoneBelow(other.bone ?? 0, bone, parents)) {
            sources[below] = source;
          }
        });
      }
    });
  }
  return sources;
};

/**
 * Decides, mesh by mesh, which meshes to draw: one level of detail at a time,
 * and not the hidden ones unless asked. A mesh no level lists is always a
 * candidate, as a file without an HLOD has no levels at all.
 */
export const getMeshVisibility = (
  scene: Pick<ModelScene, "hlod"> & {
    meshes: readonly VisibleMesh[];
    skeleton?: Pick<SceneSkeleton, "parents">;
  },
  { lod, showHidden = false, subObjectRules, partOverrides }: VisibilityOptions = {},
): boolean[] => {
  const levels = scene.hlod?.lods ?? [];
  const chosen = levels[lod ?? levels.length - 1];
  const listed = new Set(levels.flatMap((level) => level.meshes));
  const inLevel = new Set(chosen?.meshes);
  const hiding = findHidingSources(
    scene.meshes,
    subObjectRules,
    scene.skeleton?.parents,
  );

  return scene.meshes.map(
    (_, at) =>
      (partOverrides?.get(at) ?? (showHidden || !hiding[at])) &&
      (!listed.has(at) || inLevel.has(at)),
  );
};

/**
 * Finds and reads the hierarchy of a name, in its own file or the `_SKL` of
 * that stem. The game looks hierarchies up by the name inside the file, so a
 * file holding a hierarchy named otherwise does not answer for its file name.
 */
const loadHierarchy = async (
  name: string,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<W3dHierarchy | undefined> => {
  for (const stem of [name, `${name}_skl`]) {
    const bytes = await loadFile(`${stem}.w3d`);
    const hierarchy = bytes && (await tools.use(parseW3dTool)(bytes)).hierarchy;

    if (hierarchy?.name.toLowerCase() === stem.toLowerCase()) {
      return hierarchy;
    }
  }

  return undefined;
};

const toSceneSkeleton = (hierarchy: W3dHierarchy): SceneSkeleton => ({
  name: hierarchy.name,
  names: hierarchy.pivots.map((pivot) => pivot.name),
  parents: hierarchy.pivots.map((pivot) => pivot.parent),
  translations: hierarchy.pivots.flatMap((pivot) => pivot.translation),
  rotations: hierarchy.pivots.flatMap((pivot) => pivot.rotation),
});

/** Finds a skeleton by the name an animation or HLOD gives it; a file that does not parse has none */
export const loadSkeleton = async (
  name: string,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<SceneSkeleton | undefined> => {
  const hierarchy = await loadHierarchy(name, loadFile, tools).catch(
    () => undefined,
  );

  return hierarchy && toSceneSkeleton(hierarchy);
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
    hierarchy = await loadHierarchy(hierarchyName, loadFile, tools);
  }

  if (!file.meshes.length && !hierarchy) {
    throw new Error(
      animation
        ? `This is the animation ${animation.name}; its skeleton ${animation.hierarchyName} was not found`
        : "This W3D file has no meshes",
    );
  }

  const matrices = computeBoneMatrices(hierarchy);
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
    const local = bindToBones(mesh, file, matrices.length);
    const positions = mesh.positions.slice();
    const normals = mesh.normals?.slice();

    if (local) {
      skinVertices(local, matrices, positions, normals);
    }

    for (let at = 0; at < positions.length; at += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], positions[at + axis]);
        max[axis] = Math.max(max[axis], positions[at + axis]);
      }
    }

    return {
      name: mesh.name,
      container: mesh.container,
      positions,
      normals,
      uvs: mesh.uvs && flipV(mesh.uvs),
      indices: mesh.indices,
      texture: mesh.texture ? textureIndex.get(mesh.texture) : undefined,
      alphaTest: mesh.alphaTest,
      blend: mesh.blend,
      hidden: mesh.hidden,
      local,
      bone: mesh.isSkin ? undefined : local?.bones[0],
    };
  });

  const sceneHlod = file.hlod && buildSceneHlod(file.hlod, file.meshes);
  const boxes = file.boxes.map((box) => {
    const bone = file.hlod?.lods
      .flatMap((lod) => lod.subObjects)
      .find((sub) => sub.name.toLowerCase() === box.name.toLowerCase())?.bone;

    return {
      name: box.name,
      lines: buildBoxEdges(box, bone === undefined ? undefined : matrices[bone]),
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
    boxes,
    hlod: sceneHlod,
    textures,
    missing: textureNames.filter((name) => !textureIndex.has(name)),
    hierarchy: hierarchy?.name,
    skeleton: hierarchy && toSceneSkeleton(hierarchy),
    animation,
    animationSkeleton:
      animation &&
      hierarchy &&
      animation.hierarchyName.toLowerCase() !== hierarchy.name.toLowerCase()
        ? await loadSkeleton(animation.hierarchyName, loadFile, tools)
        : undefined,
    bounds: { min, max },
  };
};
