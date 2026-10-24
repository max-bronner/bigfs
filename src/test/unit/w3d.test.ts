import * as assert from 'assert';
import { parseW3d } from '../../tools/w3dTools';
import { buildW3dScene } from '../../formats/w3dScene';
import { createToolRegistry } from '../../tools/toolRegistry';

/** A chunk: type, size with the container bit when it holds chunks, payload */
export const chunk = (
  type: number,
  payload: Uint8Array,
  holdsChunks = false,
) => {
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);

  view.setUint32(0, type, true);
  view.setUint32(4, payload.length | (holdsChunks ? 0x80000000 : 0), true);

  return concat(header, payload);
};

export const concat = (...parts: Uint8Array[]): Uint8Array => {
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

export const floats = (...values: number[]) =>
  new Uint8Array(Float32Array.from(values).buffer);
export const uints = (...values: number[]) =>
  new Uint8Array(Uint32Array.from(values).buffer);

/** A fixed-length, NUL-padded name */
export const name = (text: string, length: number) => {
  const bytes = new Uint8Array(length);

  bytes.set(Array.from(text, (c) => c.charCodeAt(0)));

  return bytes;
};

/** A mesh header: attributes, names and counts at their offsets */
const meshHeader = (meshName: string, container: string, attributes = 0) => {
  const header = new Uint8Array(116);
  const view = new DataView(header.buffer);

  view.setUint32(4, attributes, true);
  header.set(name(meshName, 16), 8);
  header.set(name(container, 16), 24);
  view.setUint32(40, 1, true);
  view.setUint32(44, 3, true);

  return header;
};

/** One triangle record: three indices, attributes, normal and distance */
const triangle = (a: number, b: number, c: number) =>
  concat(uints(a, b, c, 0), floats(0, 0, 1, 0));

/** A one-triangle mesh with a texture and texture coordinates */
const mesh = (meshName: string) =>
  chunk(
    0x000,
    concat(
      chunk(0x01f, meshHeader(meshName, 'UNIT')),
      chunk(0x002, floats(0, 0, 0, 1, 0, 0, 0, 1, 0)),
      chunk(0x003, floats(0, 0, 1, 0, 0, 1, 0, 0, 1)),
      chunk(0x020, triangle(0, 1, 2)),
      chunk(0x030, chunk(0x031, chunk(0x032, name('Unit.tga', 9)), true), true),
      chunk(
        0x038,
        chunk(0x048, chunk(0x04a, floats(0, 0, 1, 0, 0, 1)), true),
        true,
      ),
    ),
    true,
  );

/** A pivot: name, parent, translation, euler angles, rotation quaternion */
const pivot = (pivotName: string, parent: number, translation: number[]) =>
  concat(
    name(pivotName, 16),
    uints(parent),
    floats(...translation, 0, 0, 0, 0, 0, 0, 1),
  );

export const hierarchy = chunk(
  0x100,
  concat(
    chunk(
      0x101,
      concat(uints(0), name('UNIT_SKL', 16), uints(2), floats(0, 0, 0)),
    ),
    chunk(
      0x102,
      concat(
        pivot('ROOTTRANSFORM', 0xffffffff, [0, 0, 0]),
        pivot('ARM', 0, [0, 0, 10]),
      ),
    ),
  ),
  true,
);

/** An HLOD placing the mesh BODY on bone 1 */
const hlod = chunk(
  0x700,
  concat(
    chunk(0x701, concat(uints(0, 1), name('UNIT', 16), name('UNIT_SKL', 16))),
    chunk(
      0x702,
      concat(
        chunk(0x703, concat(uints(1), floats(0))),
        chunk(0x704, concat(uints(1), name('UNIT.BODY', 32))),
      ),
      true,
    ),
  ),
  true,
);

suite('W3D models', () => {
  test('a mesh reads its geometry, texture name and coordinates', () => {
    const [body] = parseW3d(mesh('BODY')).meshes;

    assert.strictEqual(body.name, 'BODY');
    assert.strictEqual(body.container, 'UNIT');
    assert.strictEqual(body.isSkin, false);
    assert.deepStrictEqual(Array.from(body.indices), [0, 1, 2]);
    assert.deepStrictEqual(Array.from(body.uvs!), [0, 0, 1, 0, 0, 1]);
    assert.strictEqual(body.texture, 'Unit.tga');
  });

  test('a chunk that claims more bytes than it has is refused', () => {
    const bytes = mesh('BODY');

    new DataView(bytes.buffer).setUint32(4, 0x80000000 | 100000, true);

    assert.throws(() => parseW3d(bytes), /runs past/);
  });

  test('the scene places a mesh on the bone its HLOD names, using the skeleton file', async () => {
    const model = concat(mesh('BODY'), hlod);
    const loaded: string[] = [];
    const scene = await buildW3dScene(
      model,
      async (fileName) => {
        loaded.push(fileName);

        return fileName === 'UNIT_SKL.w3d' ? hierarchy : undefined;
      },
      createToolRegistry(),
    );

    // Bone 1 sits 10 up, so the triangle does too
    assert.deepStrictEqual(
      Array.from(scene.meshes[0].positions),
      [0, 0, 10, 1, 0, 10, 0, 1, 10],
    );
    assert.strictEqual(scene.hierarchy, 'UNIT_SKL');
    assert.deepStrictEqual(scene.missing, ['Unit.tga']);
    // A texture is looked for as DDS first, then as the TGA it names
    assert.ok(loaded.indexOf('Unit.dds') < loaded.indexOf('Unit.tga'));
    assert.deepStrictEqual(scene.bounds, { min: [0, 0, 10], max: [1, 1, 10] });
  });

  test('a skeleton on its own is shown as its bones', async () => {
    const scene = await buildW3dScene(
      hierarchy,
      async () => undefined,
      createToolRegistry(),
    );

    assert.strictEqual(scene.meshes.length, 0);
    assert.deepStrictEqual(scene.skeleton?.parents, [-1, 0]);
    assert.deepStrictEqual(scene.bounds, { min: [0, 0, 0], max: [0, 0, 10] });
  });

  test('a mesh on a bone carries its own vertices and bone for posing', async () => {
    const scene = await buildW3dScene(
      concat(mesh('BODY'), hlod),
      async (fileName) => (fileName === 'UNIT_SKL.w3d' ? hierarchy : undefined),
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
});
