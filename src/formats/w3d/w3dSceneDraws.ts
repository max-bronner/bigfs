import type { ToolBox } from "../../core/toolRegistry";
import { decodeDdsTool, decodeTgaTool } from "../texture/textureTools";
import type { RgbaImage } from "../texture/textureTools";
import { buildBumpOffsets } from "./w3dBumpMap";
import type { W3dTexture } from "./w3dMaterialChunks";
import type { W3dMaterialDraw } from "./w3dMaterial";
import type { W3dMesh } from "./w3dTools";

/** One draw of a scene mesh: `W3dMaterialDraw` with its textures found and V flipped */
export interface SceneDraw extends Omit<W3dMaterialDraw, "texture" | "detailTexture"> {
  /** Index into `ModelScene.textures`, when the texture was found */
  texture?: number;
  /** The draw names a texture, so without one it shows that one is missing */
  textured: boolean;
  /** Index into `ModelScene.textures` of the second stage's texture, when found */
  detailTexture?: number;
}

/** How a scene texture is sampled */
export interface SceneTextureAddressing {
  clampU: boolean;
  clampV: boolean;
}

/** Finds an entry by file name, matched without casing, wherever it lives */
export type LoadFile = (fileName: string) => Promise<Uint8Array | undefined>;

/** What a model's draws need from outside the file */
export interface SceneDraws {
  textures: RgbaImage[];
  /** How each of `textures` is sampled, by index */
  addressing: SceneTextureAddressing[];
  /** Texture names no archive or folder holds */
  missing: string[];
  /** The draws of each mesh, by index */
  draws: SceneDraw[][];
  /** The first pass's coordinates of each mesh, the same arrays its draws hold */
  uvs: (Float32Array | undefined)[];
}

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

/** One way a draw samples a texture; two draws that ask alike share one upload */
interface TextureUse extends W3dTexture {
  /** The texture is a height map a bump stage reads as offsets */
  isBumpMap?: boolean;
}

const getUseKey = ({ name, clampU, clampV, isBumpMap }: TextureUse) =>
  `${name}|${clampU}|${clampV}|${!!isBumpMap}`;

const getBaseUse = ({ texture, surface }: W3dMaterialDraw): TextureUse | undefined =>
  texture && { ...texture, isBumpMap: surface.bumpOffset };

const getUses = (draw: W3dMaterialDraw): TextureUse[] =>
  [getBaseUse(draw), draw.detailTexture].flatMap((use) => (use ? [use] : []));

/** Loads the textures a model's draws name and turns its draws into scene draws */
export const loadSceneDraws = async (
  meshes: readonly W3dMesh[],
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<SceneDraws> => {
  const uses = new Map(
    meshes.flatMap((mesh) =>
      mesh.draws.flatMap(getUses).map((use) => [getUseKey(use), use] as const),
    ),
  );
  const names = [...new Set([...uses.values()].map((use) => use.name))];
  const decoded = new Map(
    await Promise.all(
      names.map(async (name) => [name, await loadTexture(name, loadFile, tools)] as const),
    ),
  );
  const textures: RgbaImage[] = [];
  const addressing: SceneTextureAddressing[] = [];
  const indexOfUse = new Map<string, number>();

  for (const [key, use] of uses) {
    const image = decoded.get(use.name);

    if (image) {
      indexOfUse.set(key, textures.length);
      textures.push(use.isBumpMap ? buildBumpOffsets(image) : image);
      addressing.push({ clampU: use.clampU, clampV: use.clampV });
    }
  }

  const findIndex = (use: TextureUse | undefined) =>
    use && indexOfUse.get(getUseKey(use));
  const flipAll = meshes.map(() => {
    const flipped = new Map<Float32Array, Float32Array>();

    return (uvs: Float32Array | undefined) => {
      if (uvs && !flipped.has(uvs)) {
        flipped.set(uvs, flipV(uvs));
      }
      return uvs && flipped.get(uvs);
    };
  });

  return {
    textures,
    addressing,
    missing: names.filter((name) => !decoded.get(name)),
    draws: meshes.map((mesh, at) =>
      mesh.draws.map((draw) => ({
        ...draw,
        uvs: flipAll[at](draw.uvs),
        detailUvs: flipAll[at](draw.detailUvs),
        texture: findIndex(getBaseUse(draw)),
        textured: !!draw.texture,
        detailTexture: findIndex(draw.detailTexture),
      })),
    ),
    uvs: meshes.map((mesh, at) => flipAll[at](mesh.uvs)),
  };
};
