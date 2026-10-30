import * as assert from "assert";
import { parseW3d } from "../../formats/w3d/w3dTools";
import { buildW3dScene, getMeshVisibility } from "../../formats/w3d/w3dScene";
import { createToolRegistry } from "../../core/toolRegistry";

/** Builds a W3D chunk: type, size with the container bit when it holds chunks, payload */
export const buildChunk = (
  type: number,
  payload: Uint8Array,
  holdsChunks = false,
) => {
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);

  view.setUint32(0, type, true);
  view.setUint32(4, payload.length | (holdsChunks ? 0x80000000 : 0), true);

  return concatBytes(header, payload);
};

/** Joins byte arrays end to end */
export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/** Encodes numbers as little-endian 32-bit floats */
export const encodeFloats = (...values: number[]) =>
  new Uint8Array(Float32Array.from(values).buffer);
/** Encodes numbers as little-endian 32-bit unsigned words */
export const encodeUints = (...values: number[]) =>
  new Uint8Array(Uint32Array.from(values).buffer);

/** Encodes a fixed-length, NUL-padded name */
export const encodeName = (text: string, length: number) => {
  const bytes = new Uint8Array(length);

  bytes.set(Array.from(text, (c) => c.charCodeAt(0)));

  return bytes;
};

/** A mesh header: attributes, names and counts at their offsets */
const meshHeader = (meshName: string, container: string, attributes = 0) => {
  const header = new Uint8Array(116);
  const view = new DataView(header.buffer);

  view.setUint32(4, attributes, true);
  header.set(encodeName(meshName, 16), 8);
  header.set(encodeName(container, 16), 24);
  view.setUint32(40, 1, true);
  view.setUint32(44, 3, true);

  return header;
};

/** One triangle record: three indices, attributes, normal and distance */
const triangle = (a: number, b: number, c: number) =>
  concatBytes(encodeUints(a, b, c, 0), encodeFloats(0, 0, 1, 0));

/** A one-triangle mesh with a texture and texture coordinates */
const mesh = (meshName: string) =>
  buildChunk(
    0x000,
    concatBytes(
      buildChunk(0x01f, meshHeader(meshName, "UNIT")),
      buildChunk(0x002, encodeFloats(0, 0, 0, 1, 0, 0, 0, 1, 0)),
      buildChunk(0x003, encodeFloats(0, 0, 1, 0, 0, 1, 0, 0, 1)),
      buildChunk(0x020, triangle(0, 1, 2)),
      buildChunk(0x030, buildChunk(0x031, buildChunk(0x032, encodeName("Unit.tga", 9)), true), true),
      buildChunk(
        0x038,
        buildChunk(
          0x048,
          // The stage names its texture by index into the table
          concatBytes(
            buildChunk(0x049, encodeUints(0)),
            buildChunk(0x04a, encodeFloats(0, 0, 1, 0, 0, 1)),
          ),
          true,
        ),
        true,
      ),
    ),
    true,
  );

/** A pivot: name, parent, translation, euler angles, rotation quaternion */
const pivot = (pivotName: string, parent: number, translation: number[]) =>
  concatBytes(
    encodeName(pivotName, 16),
    encodeUints(parent),
    encodeFloats(...translation, 0, 0, 0, 0, 0, 0, 1),
  );

/** The `UNIT_SKL` hierarchy chunk: the root transform and bone 1, ARM, 10 up the z axis */
export const hierarchy = buildChunk(
  0x100,
  concatBytes(
    buildChunk(
      0x101,
      concatBytes(encodeUints(0), encodeName("UNIT_SKL", 16), encodeUints(2), encodeFloats(0, 0, 0)),
    ),
    buildChunk(
      0x102,
      concatBytes(
        pivot("ROOTTRANSFORM", 0xffffffff, [0, 0, 0]),
        pivot("ARM", 0, [0, 0, 10]),
      ),
    ),
  ),
  true,
);

/** An HLOD placing the mesh BODY on bone 1 */
const hlod = buildChunk(
  0x700,
  concatBytes(
    buildChunk(0x701, concatBytes(encodeUints(0, 1), encodeName("UNIT", 16), encodeName("UNIT_SKL", 16))),
    buildChunk(
      0x702,
      concatBytes(
        buildChunk(0x703, concatBytes(encodeUints(1), encodeFloats(0))),
        buildChunk(0x704, concatBytes(encodeUints(1), encodeName("UNIT.BODY", 32))),
      ),
      true,
    ),
  ),
  true,
);

suite("W3D models", () => {
  test("a mesh reads its geometry, texture name and coordinates", () => {
    const [body] = parseW3d(mesh("BODY")).meshes;

    assert.strictEqual(body.name, "BODY");
    assert.strictEqual(body.container, "UNIT");
    assert.strictEqual(body.isSkin, false);
    assert.deepStrictEqual(Array.from(body.indices), [0, 1, 2]);
    assert.deepStrictEqual(Array.from(body.uvs!), [0, 0, 1, 0, 0, 1]);
    assert.strictEqual(body.texture, "Unit.tga");
  });

  test("a chunk that claims more bytes than it has is refused", () => {
    const bytes = mesh("BODY");

    new DataView(bytes.buffer).setUint32(4, 0x80000000 | 100000, true);

    assert.throws(() => parseW3d(bytes), /runs past/);
  });

  test("the scene places a mesh on the bone its HLOD names, using the skeleton file", async () => {
    const model = concatBytes(mesh("BODY"), hlod);
    const loaded: string[] = [];
    const scene = await buildW3dScene(
      model,
      async (fileName) => {
        loaded.push(fileName);

        return fileName === "UNIT_SKL.w3d" ? hierarchy : undefined;
      },
      createToolRegistry(),
    );

    // Bone 1 sits 10 up, so the triangle does too
    assert.deepStrictEqual(
      Array.from(scene.meshes[0].positions),
      [0, 0, 10, 1, 0, 10, 0, 1, 10],
    );
    assert.strictEqual(scene.hierarchy, "UNIT_SKL");
    assert.deepStrictEqual(scene.missing, ["Unit.tga"]);
    // A texture is looked for as DDS first, then as the TGA it names
    assert.ok(loaded.indexOf("Unit.dds") < loaded.indexOf("Unit.tga"));
    assert.deepStrictEqual(scene.bounds, { min: [0, 0, 10], max: [1, 1, 10] });
    // W3D measures V from the bottom; the scene is drawn with V from the top
    assert.deepStrictEqual(
      Array.from(scene.meshes[0].uvs!),
      [0, 1, 1, 1, 0, 0],
    );
  });

  test("a skeleton on its own is shown as its bones", async () => {
    const scene = await buildW3dScene(
      hierarchy,
      async () => undefined,
      createToolRegistry(),
    );

    assert.strictEqual(scene.meshes.length, 0);
    assert.deepStrictEqual(scene.skeleton?.parents, [-1, 0]);
    assert.deepStrictEqual(scene.bounds, { min: [0, 0, 0], max: [0, 0, 10] });
  });

  test("a mesh on a bone carries its own vertices and bone for posing", async () => {
    const scene = await buildW3dScene(
      concatBytes(mesh("BODY"), hlod),
      async (fileName) => (fileName === "UNIT_SKL.w3d" ? hierarchy : undefined),
      createToolRegistry(),
    );

    assert.deepStrictEqual(
      Array.from(scene.meshes[0].local?.bones ?? []),
      [1, 1, 1],
    );
    assert.deepStrictEqual(
      Array.from(scene.meshes[0].local?.positions ?? []),
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    );
  });

  test("a mesh with the HIDDEN attribute is flagged and left out unless asked for", async () => {
    const hiddenMesh = buildChunk(
      0x000,
      concatBytes(
        buildChunk(0x01f, meshHeader("GLOW", "UNIT", 0x1000)),
        buildChunk(0x002, encodeFloats(0, 0, 0, 1, 0, 0, 0, 1, 0)),
        buildChunk(0x020, triangle(0, 1, 2)),
      ),
      true,
    );
    const scene = await buildW3dScene(
      concatBytes(mesh("BODY"), hiddenMesh),
      async () => undefined,
      createToolRegistry(),
    );

    assert.deepStrictEqual(
      scene.meshes.map((each) => each.hidden),
      [false, true],
    );
    assert.deepStrictEqual(getMeshVisibility(scene), [true, false]);
    assert.deepStrictEqual(getMeshVisibility(scene, { showHidden: true }), [
      true,
      true,
    ]);
  });

  test("every HLOD level is read with its screen size, aggregates and proxies", () => {
    const array = (type: number, size: number, ...subs: string[]) =>
      buildChunk(
        type,
        concatBytes(
          buildChunk(0x703, concatBytes(encodeUints(subs.length), encodeFloats(size))),
          ...subs.map((sub) => buildChunk(0x704, concatBytes(encodeUints(0), encodeName(sub, 32)))),
        ),
        true,
      );
    const file = parseW3d(
      buildChunk(
        0x700,
        concatBytes(
          buildChunk(0x701, concatBytes(encodeUints(0, 2), encodeName("UNIT", 16), encodeName("", 16))),
          array(0x702, 20, "UNIT.LOW"),
          array(0x702, 3.4e38, "UNIT.HIGH", "UNIT.EXTRA"),
          array(0x705, 0, "OTHER.MODEL"),
          array(0x706, 0, "BONE_A"),
        ),
        true,
      ),
    );

    assert.strictEqual(file.hlod?.lods.length, 2);
    assert.strictEqual(file.hlod?.lods[0].maxScreenSize, 20);
    assert.deepStrictEqual(
      file.hlod?.subObjects.map((sub) => sub.name),
      ["UNIT.HIGH", "UNIT.EXTRA"],
    );
    assert.deepStrictEqual(
      file.hlod?.aggregates?.subObjects.map((sub) => sub.name),
      ["OTHER.MODEL"],
    );
    assert.deepStrictEqual(
      file.hlod?.proxies?.subObjects.map((sub) => sub.name),
      ["BONE_A"],
    );
  });

  test("one level of detail is drawn at a time, the finest by default", async () => {
    const level = (size: number, sub: string) =>
      buildChunk(
        0x702,
        concatBytes(
          buildChunk(0x703, concatBytes(encodeUints(1), encodeFloats(size))),
          buildChunk(0x704, concatBytes(encodeUints(0), encodeName(sub, 32))),
        ),
        true,
      );
    const model = concatBytes(
      mesh("LOW"),
      mesh("HIGH"),
      buildChunk(
        0x700,
        concatBytes(
          buildChunk(0x701, concatBytes(encodeUints(0, 2), encodeName("UNIT", 16), encodeName("", 16))),
          level(20, "UNIT.LOW"),
          level(3.4e38, "UNIT.HIGH"),
        ),
        true,
      ),
    );
    const scene = await buildW3dScene(
      model,
      async () => undefined,
      createToolRegistry(),
    );

    assert.deepStrictEqual(
      scene.hlod?.lods.map((lod) => [lod.maxScreenSize, lod.meshes]),
      [
        [20, [0]],
        [undefined, [1]],
      ],
    );
    assert.deepStrictEqual(getMeshVisibility(scene), [false, true]);
    assert.deepStrictEqual(getMeshVisibility(scene, { lod: 0 }), [true, false]);
  });

  test("a BOX chunk becomes twelve wireframe edges at its bone", async () => {
    const box = (attributes: number) =>
      buildChunk(
        0x740,
        concatBytes(
          encodeUints(0, attributes),
          encodeName("UNIT.COLBOX", 32),
          new Uint8Array(4),
          encodeFloats(0, 0, 0, 1, 2, 3),
        ),
      );
    const hlodOnBone = buildChunk(
      0x700,
      concatBytes(
        buildChunk(
          0x701,
          concatBytes(encodeUints(0, 1), encodeName("UNIT", 16), encodeName("UNIT_SKL", 16)),
        ),
        buildChunk(
          0x702,
          concatBytes(
            buildChunk(0x703, concatBytes(encodeUints(1), encodeFloats(0))),
            buildChunk(0x704, concatBytes(encodeUints(1), encodeName("UNIT.COLBOX", 32))),
          ),
          true,
        ),
      ),
      true,
    );
    const scene = await buildW3dScene(
      concatBytes(mesh("BODY"), box(1), hlodOnBone),
      async (fileName) => (fileName === "UNIT_SKL.w3d" ? hierarchy : undefined),
      createToolRegistry(),
    );
    const lines = scene.boxes[0].lines;

    assert.strictEqual(scene.boxes[0].name, "UNIT.COLBOX");
    assert.strictEqual(lines.length, 12 * 2 * 3);
    // Bone 1 sits 10 up, so the box spans z 7 to 13
    assert.strictEqual(Math.min(...lines.filter((_, at) => at % 3 === 2)), 7);
    assert.strictEqual(Math.max(...lines.filter((_, at) => at % 3 === 2)), 13);
  });

  test("a BOX or HLOD array too short for its layout is refused with a message", () => {
    assert.throws(
      () => parseW3d(buildChunk(0x740, new Uint8Array(10))),
      /BOX chunk is 10 bytes/,
    );
    assert.throws(
      () =>
        parseW3d(
          buildChunk(
            0x700,
            concatBytes(
              buildChunk(0x701, new Uint8Array(40)),
              buildChunk(0x702, buildChunk(0x703, new Uint8Array(4)), true),
            ),
            true,
          ),
        ),
      /HLOD array header is 4 bytes/,
    );
  });
});
