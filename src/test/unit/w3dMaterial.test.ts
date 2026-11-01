import * as assert from "assert";
import { parseW3d } from "../../formats/w3d/w3dTools";
import { classifyBlend, DEFAULT_SURFACE, resolveVertexColour } from "../../formats/w3d/w3dMaterial";
import type { W3dShader } from "../../formats/w3d/w3dMaterialChunks";
import { buildChunk, concatBytes, encodeFloats, encodeName, encodeUints } from "./w3d.test";

/** A `SHADERS` entry; every byte not given is the file's zero */
const shaderBytes = (fields: Partial<W3dShader> = {}) => {
  const bytes = new Uint8Array(16);

  bytes[0] = fields.depthCompare ?? 3;
  bytes[1] = fields.depthMask ?? 1;
  bytes[3] = fields.destBlend ?? 0;
  bytes[5] = fields.primaryGradient ?? 1;
  bytes[7] = fields.srcBlend ?? 1;
  bytes[8] = fields.texturing ?? 1;
  bytes[9] = fields.detailColor ?? 0;
  bytes[10] = fields.detailAlpha ?? 0;
  bytes[12] = fields.alphaTest ?? 0;
  return bytes;
};

const textureTable = (...names: string[]) =>
  buildChunk(
    0x030,
    concatBytes(
      ...names.map((name) =>
        buildChunk(0x031, buildChunk(0x032, encodeName(name, name.length + 1)), true),
      ),
    ),
    true,
  );

/** A pass of one stage over the three vertices of `triangles` */
const pass = (textureIds: number[], shaderIds: number[], ...more: Uint8Array[]) =>
  buildChunk(
    0x038,
    concatBytes(
      buildChunk(0x03a, encodeUints(...shaderIds)),
      buildChunk(
        0x048,
        concatBytes(
          buildChunk(0x049, encodeUints(...textureIds)),
          buildChunk(0x04a, encodeFloats(0, 0, 1, 0, 0, 1, 1, 1)),
        ),
        true,
      ),
      ...more,
    ),
    true,
  );

/** A shader material chunk: its effect's name and `[type, name, value bytes]` parameters */
const fxMaterial = (effect: string, ...properties: [number, string, Uint8Array][]) => {
  const header = new Uint8Array(37);

  header[0] = 1;
  header.set(encodeName(effect, 32), 1);

  return buildChunk(
    0x051,
    concatBytes(
      buildChunk(0x052, header),
      ...properties.map(([type, name, value]) =>
        buildChunk(
          0x053,
          concatBytes(
            encodeUints(type, name.length + 1),
            encodeName(name, name.length + 1),
            value,
          ),
        ),
      ),
    ),
    true,
  );
};

/** A texture-valued parameter's bytes: a length, then the NUL-ended name */
const fxText = (text: string) =>
  concatBytes(encodeUints(text.length + 1), encodeName(text, text.length + 1));

/** A `VERTEX_MATERIALS` table of identical materials, colours as 0-255 bytes */
const vertexMaterials = (
  attributes: number,
  ambient: number[],
  diffuse: number[],
  emissive: number[],
  opacity: number,
  count = 2,
) => {
  const info = new Uint8Array(32);
  const view = new DataView(info.buffer);

  view.setUint32(0, attributes, true);
  info.set(ambient, 4);
  info.set(diffuse, 8);
  info.set(emissive, 16);
  view.setFloat32(24, opacity, true);

  const material = buildChunk(0x02b, buildChunk(0x02d, info), true);

  return buildChunk(0x02a, concatBytes(...Array<Uint8Array>(count).fill(material)), true);
};

/** Builds a file of one two-triangle mesh with the material chunks given */
const buildMesh = (attributes: number, name: string, ...chunks: Uint8Array[]) => {
  const header = new Uint8Array(116);
  const view = new DataView(header.buffer);

  view.setUint32(4, attributes, true);
  header.set(encodeName(name, 16), 8);
  header.set(encodeName("UNIT", 16), 24);
  view.setUint32(40, 2, true);
  view.setUint32(44, 4, true);

  return buildChunk(
    0x000,
    concatBytes(
      buildChunk(0x01f, header),
      buildChunk(0x002, encodeFloats(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0)),
      buildChunk(
        0x020,
        concatBytes(
          encodeUints(0, 1, 2, 0),
          encodeFloats(0, 0, 1, 0),
          encodeUints(1, 3, 2, 0),
          encodeFloats(0, 0, 1, 0),
        ),
      ),
      ...chunks,
    ),
    true,
  );
};

const parseMesh = (...chunks: Uint8Array[]) =>
  parseW3d(buildMesh(0, "BODY", ...chunks)).meshes[0];

suite("W3D materials", () => {
  test("each factor pair the shipped shaders use has its own blend", () => {
    const blendOf = (srcBlend: number, destBlend: number) =>
      classifyBlend({ ...parseShader(), srcBlend, destBlend });

    assert.strictEqual(blendOf(1, 0), "opaque");
    assert.strictEqual(blendOf(1, 1), "additive");
    assert.strictEqual(blendOf(2, 5), "alpha");
    assert.strictEqual(blendOf(0, 2), "multiply");
    assert.strictEqual(blendOf(1, 2), "addScaledByColor");
    assert.strictEqual(blendOf(1, 3), "addInverseScaledByColor");
    assert.strictEqual(blendOf(1, 4), "addScaledByAlpha");
  });

  test("an alpha blend that writes depth and alpha-tests is a cutout", () => {
    const shader = { ...parseShader(), srcBlend: 2, destBlend: 5, alphaTest: 1, depthMask: 1 };

    assert.strictEqual(classifyBlend(shader), "opaque");
    assert.strictEqual(classifyBlend({ ...shader, depthMask: 0 }), "alpha");
  });

  test("a mesh with one of everything is one draw over all of it", () => {
    const mesh = parseMesh(
      buildChunk(0x029, shaderBytes({ destBlend: 1 })),
      textureTable("A.tga"),
      pass([0], [0]),
    );

    assert.strictEqual(mesh.draws.length, 1);
    assert.strictEqual(mesh.draws[0].indices, undefined);
    assert.strictEqual(mesh.draws[0].texture?.name, "A.tga");
    assert.strictEqual(mesh.draws[0].surface.blend, "additive");
  });

  test("triangles of one pass split by the texture and shader each names", () => {
    const mesh = parseMesh(
      buildChunk(0x029, concatBytes(shaderBytes(), shaderBytes({ destBlend: 1 }))),
      textureTable("A.tga", "B.tga"),
      pass([0, 1], [0, 1]),
    );

    assert.deepStrictEqual(
      mesh.draws.map((draw) => [
        draw.texture?.name,
        draw.surface.blend,
        Array.from(draw.indices ?? []),
      ]),
      [
        ["A.tga", "opaque", [0, 1, 2]],
        ["B.tga", "additive", [1, 3, 2]],
      ],
    );
  });

  test("a later pass is a draw of its own, and the mesh's own fields stay on the first", () => {
    const mesh = parseMesh(
      buildChunk(0x029, concatBytes(shaderBytes(), shaderBytes({ destBlend: 1 }))),
      textureTable("Base.tga", "Glow.tga"),
      pass([0], [0]),
      pass([1], [1]),
    );

    assert.deepStrictEqual(
      mesh.draws.map((draw) => [draw.pass, draw.texture?.name, draw.surface.blend]),
      [
        [0, "Base.tga", "opaque"],
        [1, "Glow.tga", "additive"],
      ],
    );
    assert.strictEqual(mesh.texture, "Base.tga");
    assert.strictEqual(mesh.blend, "opaque");
  });

  test("a shader's depth test reaches the surface", () => {
    const mesh = parseMesh(
      buildChunk(0x029, shaderBytes({ depthCompare: 7 })),
      pass([0], [0]),
    );

    assert.strictEqual(mesh.draws[0].surface.depthCompare, 7);
  });

  test("a shader material's texture and states are read by name", () => {
    const mesh = parseMesh(
      buildChunk(
        0x050,
        fxMaterial(
          "Simple.fx",
          [7, "AlphaBlendingEnable", Uint8Array.of(1)],
          [1, "Texture_0", fxText("Sky.tga")],
        ),
        true,
      ),
      buildChunk(0x038, buildChunk(0x03f, encodeUints(0)), true),
    );

    assert.strictEqual(mesh.draws[0].texture?.name, "Sky.tga");
    assert.strictEqual(mesh.draws[0].surface.blend, "alpha");
  });

  test("the two-sided attribute and a picking proxy's name are read", () => {
    const mesh = parseW3d(buildMesh(0x2000, "PICKBOX")).meshes[0];

    assert.strictEqual(mesh.draws[0].surface.twoSided, true);
    assert.strictEqual(mesh.pickProxy, true);
    assert.strictEqual(parseMesh().pickProxy, false);
  });

  test("a vertex material's colours and opacity reach the surface", () => {
    const { surface } = parseMesh(
      vertexMaterials(0, [255, 0, 0], [0, 255, 0], [0, 0, 255], 0.5),
      buildChunk(0x029, shaderBytes()),
      buildChunk(0x038, concatBytes(buildChunk(0x039, encodeUints(0)), buildChunk(0x03a, encodeUints(0))), true),
    ).draws[0];

    assert.deepStrictEqual(surface.ambient, [1, 0, 0]);
    assert.deepStrictEqual(surface.diffuse, [0, 1, 0]);
    assert.deepStrictEqual(surface.emissive, [0, 0, 1]);
    assert.strictEqual(surface.opacity, 0.5);
  });

  test("a vertex takes the material its table names, and a triangle its first vertex's", () => {
    const mesh = parseMesh(
      vertexMaterials(0, [255, 255, 255], [255, 255, 255], [0, 0, 0], 1),
      buildChunk(
        0x038,
        buildChunk(0x039, encodeUints(0, 1, 1, 1)),
        true,
      ),
    );

    assert.deepStrictEqual(
      mesh.draws.map((draw) => Array.from(draw.indices ?? [])),
      [[0, 1, 2], [1, 3, 2]],
    );
  });

  test("an emissive-only material with vertex colours turns the lights off", () => {
    const use = resolveVertexColour(false, {
      ...DEFAULT_SURFACE,
      ambient: [0, 0, 0],
      diffuse: [0, 0, 0],
      emissive: [0.5, 0.5, 0.5],
      opacity: 0.25,
    });

    assert.strictEqual(use.replacesLighting, true);
    assert.deepStrictEqual(use.scale, [0.5, 0.5, 0.5]);
    assert.strictEqual(use.alphaScale, 0.25);
  });

  test("a black material with vertex colours lights them, unscaled, rather than drawing black", () => {
    const use = resolveVertexColour(false, {
      ...DEFAULT_SURFACE,
      ambient: [0, 0, 0],
      diffuse: [0, 0, 0],
      emissive: [0, 0, 0],
    });

    assert.strictEqual(use.diffuse, true);
    assert.strictEqual(use.replacesLighting, false);
    assert.deepStrictEqual(use.scale, [1, 1, 1]);
  });

  test("on the effect path vertex colours multiply the result and stand for no colour", () => {
    const mesh = parseMesh(
      vertexMaterials(0, [255, 255, 255], [255, 255, 255], [0, 0, 0], 1, 1),
      buildChunk(0x029, shaderBytes()),
      textureTable("A.tga"),
      pass([0], [0], buildChunk(0x039, encodeUints(0)), buildChunk(0x03b, new Uint8Array(16).fill(255))),
    );

    assert.strictEqual(mesh.draws[0].surface.vertexColour?.multipliesResult, true);
    assert.strictEqual(mesh.draws[0].surface.vertexColour?.diffuse, false);
    assert.strictEqual(mesh.draws[0].colors?.length, 16);
  });

  test("a vertex colour array that does not fit the vertices is dropped", () => {
    const mesh = parseMesh(pass([0], [0], buildChunk(0x03b, new Uint8Array(8))));

    assert.strictEqual(mesh.draws[0].colors, undefined);
    assert.strictEqual(mesh.draws[0].surface.vertexColour, undefined);
  });

  test("the shader byte and Simple.fx turn a draw unlit, and slot five doubles a textured fixed-function stage", () => {
    const unlit = parseMesh(
      buildChunk(0x029, shaderBytes({ primaryGradient: 0 })),
      pass([0], [0]),
    );
    const sky = parseMesh(
      buildChunk(0x050, fxMaterial("Simple.fx", [1, "Texture_0", fxText("Sky.tga")]), true),
      buildChunk(0x038, buildChunk(0x03f, encodeUints(0)), true),
    );
    const doubled = parseMesh(
      buildChunk(0x029, shaderBytes({ primaryGradient: 5 })),
      textureTable("A.tga"),
      pass([0], [0]),
    );

    assert.strictEqual(unlit.draws[0].surface.unlit, true);
    assert.strictEqual(sky.draws[0].surface.unlit, true);
    assert.strictEqual(doubled.draws[0].surface.modulate2x, true);
  });

  test("the sort level of a mesh reaches its surface, and an out of range one is none", () => {
    const withLevel = (level: number) => {
      const bytes = buildMesh(0, "BODY");

      // Past the mesh and chunk headers, the level sits 56 into the header
      new DataView(bytes.buffer).setInt32(8 + 8 + 56, level, true);
      return parseW3d(bytes).meshes[0].draws[0].surface.sortLevel;
    };

    assert.strictEqual(withLevel(5), 5);
    assert.strictEqual(withLevel(99), 0);
  });
});

/** A shader's fields as a chunk stores them with no byte set */
const parseShader = (): W3dShader => ({
  depthCompare: 3,
  depthMask: 1,
  destBlend: 0,
  primaryGradient: 1,
  srcBlend: 1,
  texturing: 1,
  detailColor: 0,
  detailAlpha: 0,
  alphaTest: 0,
});
