import * as assert from "assert";
import { parseW3d } from "../../formats/w3d/w3dTools";
import { createToolRegistry } from "../../core/toolRegistry";
import {
  DEFAULT_SURFACE,
  MAX_DRAWS_PER_MESH,
  MAX_PASSES_PER_MESH,
  resolveMaterialDraws,
} from "../../formats/w3d/w3dMaterial";
import { loadSceneDraws, MAX_TEXTURE_NAMES } from "../../formats/w3d/w3dSceneDraws";
import type { W3dMesh } from "../../formats/w3d/w3dTools";
import type { W3dMeshMaterials, W3dShader } from "../../formats/w3d/w3dMaterialChunks";
import { MAX_NAME_LENGTH } from "../../formats/w3d/w3dChunks";
import { buildChunk, concatBytes, encodeFloats, encodeUints } from "./w3d.test";

const shader = (fields: Partial<W3dShader> = {}): W3dShader => ({
  depthCompare: 3,
  depthMask: 1,
  destBlend: 0,
  primaryGradient: 1,
  srcBlend: 1,
  texturing: 1,
  detailColor: 0,
  detailAlpha: 0,
  alphaTest: 0,
  ...fields,
});

const emptyPass = { vertexMaterialIds: [], shaderIds: [], fxMaterialIds: [], stages: [] };

/** A mesh of `triangles` triangles over `vertices` shared vertices */
const geometry = (triangles: number) => ({
  indices: Uint32Array.from({ length: triangles * 3 }, (_, at) => at % 3),
  vertexCount: 3,
  twoSided: false,
  sortLevel: 0,
});

/** A mesh file of one triangle whose first texture is named by `nameBytes` */
const meshWithTexture = (nameBytes: Uint8Array) => {
  const header = new Uint8Array(116);
  const view = new DataView(header.buffer);

  view.setUint32(40, 1, true);
  view.setUint32(44, 3, true);

  return buildChunk(
    0x000,
    concatBytes(
      buildChunk(0x01f, header),
      buildChunk(0x002, encodeFloats(0, 0, 0, 1, 0, 0, 0, 1, 0)),
      buildChunk(0x020, concatBytes(encodeUints(0, 1, 2, 0), encodeFloats(0, 0, 1, 0))),
      buildChunk(
        0x030,
        buildChunk(0x031, buildChunk(0x032, nameBytes), true),
        true,
      ),
      buildChunk(0x038, buildChunk(0x048, buildChunk(0x049, encodeUints(0)), true), true),
    ),
    true,
  );
};

suite("W3D material limits", () => {
  test("passes past the cap are dropped", () => {
    const materials: W3dMeshMaterials = {
      shaders: [shader()],
      vertexMaterials: [],
      textures: [],
      fxMaterials: [],
      passes: Array.from({ length: 5000 }, () => ({ ...emptyPass, shaderIds: [0] })),
    };
    const draws = resolveMaterialDraws(materials, geometry(1));

    assert.strictEqual(draws.length, MAX_PASSES_PER_MESH);
    assert.strictEqual(draws[draws.length - 1].pass, MAX_PASSES_PER_MESH - 1);
  });

  test("a mesh that would split into too many draws draws each pass whole", () => {
    const triangles = MAX_DRAWS_PER_MESH + 44;
    const materials: W3dMeshMaterials = {
      shaders: [shader()],
      vertexMaterials: [],
      textures: Array.from({ length: triangles }, (_, at) => ({
        name: `T${at}.tga`,
        clampU: false,
        clampV: false,
      })),
      fxMaterials: [],
      passes: [
        { ...emptyPass, shaderIds: [0], stages: [{ textureIds: Array.from({ length: triangles }, (_, at) => at) }] },
      ],
    };
    const draws = resolveMaterialDraws(materials, geometry(triangles));

    assert.strictEqual(draws.length, 1);
    assert.strictEqual(draws[0].indices, undefined);
  });

  test("ids past their tables name nothing, and triangles naming nothing draw together", () => {
    const materials: W3dMeshMaterials = {
      shaders: [shader()],
      vertexMaterials: [],
      textures: [{ name: "A.tga", clampU: false, clampV: false }],
      fxMaterials: [],
      passes: [
        { ...emptyPass, shaderIds: [9000, 9001], stages: [{ textureIds: [5, 70000] }] },
      ],
    };
    const draws = resolveMaterialDraws(materials, geometry(2));

    assert.strictEqual(draws.length, 1);
    assert.strictEqual(draws[0].texture, undefined);
  });

  test("a texture name of any length is cut, not thrown on", () => {
    const [mesh] = parseW3d(meshWithTexture(new Uint8Array(300_000).fill(0x41))).meshes;

    assert.strictEqual(mesh.draws[0].texture?.name.length, MAX_NAME_LENGTH);
  });

  test("a depth function byte past the defined ones is clamped to always", () => {
    const materials: W3dMeshMaterials = {
      shaders: [shader({ depthCompare: 200 })],
      vertexMaterials: [],
      textures: [],
      fxMaterials: [],
      passes: [{ ...emptyPass, shaderIds: [0] }],
    };

    assert.strictEqual(resolveMaterialDraws(materials, geometry(1))[0].surface.depthCompare, 7);
  });

  test("a blended draw writes depth when its shader's depth mask says so", () => {
    const draw = (depthMask: number) =>
      resolveMaterialDraws(
        {
          shaders: [shader({ srcBlend: 2, destBlend: 5, depthMask })],
          vertexMaterials: [],
          textures: [],
          fxMaterials: [],
          passes: [{ ...emptyPass, shaderIds: [0] }],
        },
        geometry(1),
      )[0].surface;

    assert.strictEqual(draw(1).depthWrite, true);
    assert.strictEqual(draw(0).depthWrite, false);
  });

  test("a scene loads no more distinct textures than the cap", async () => {
    const mesh = {
      draws: Array.from({ length: MAX_TEXTURE_NAMES + 50 }, (_, at) => ({
        pass: 0,
        surface: DEFAULT_SURFACE,
        texture: { name: `T${at}.tga`, clampU: false, clampV: false },
      })),
    } as unknown as W3dMesh;
    const asked = new Set<string>();
    const scene = await loadSceneDraws(
      [mesh],
      async (name) => {
        asked.add(name.replace(/\.[^.]*$/, ""));
        return undefined;
      },
      createToolRegistry(),
    );

    assert.strictEqual(asked.size, MAX_TEXTURE_NAMES);
    assert.strictEqual(scene.missing.length, MAX_TEXTURE_NAMES + 50);
  });
});
