import * as assert from 'assert';
import { applyMapEdit, parseMap, writeMap } from '../../formats/map/mapFile';
import {
  compressEar,
  compressRefPack,
  decompressRefPack,
} from '../../formats/refpack';

/** Builds a synthetic map body, since no shipped map may be committed */
const buildMap = () => {
  const names = [
    'WorldInfo',
    'HeightMapData',
    'GlobalLighting',
    'ObjectsList',
    'Object',
    'SidesList',
    'mapName',
    'weather',
    'objectName',
    'playerName',
    'isHuman',
  ];
  const out: number[] = [];
  const u8 = (...values: number[]) => out.push(...values);
  const u16 = (value: number) => out.push(value & 255, value >> 8);
  const u32 = (value: number) =>
    out.push(
      value & 255,
      (value >>> 8) & 255,
      (value >>> 16) & 255,
      (value >>> 24) & 255,
    );
  const f32 = (value: number) =>
    out.push(...new Uint8Array(new Float32Array([value]).buffer));
  const str = (text: string) => {
    u16(text.length);
    out.push(...Array.from(text, (char) => char.charCodeAt(0)));
  };
  const key = (name: string, type: number) =>
    u32(((names.indexOf(name) + 1) << 8) | type);
  const chunk = (name: string, version: number, body: () => void) => {
    u32(names.indexOf(name) + 1);
    u16(version);

    const lengthAt = out.length;

    u32(0);

    const start = out.length;

    body();

    const length = out.length - start;

    out.splice(
      lengthAt,
      4,
      length & 255,
      (length >>> 8) & 255,
      (length >>> 16) & 255,
      length >>> 24,
    );
  };

  out.push(...Array.from('CkMp', (char) => char.charCodeAt(0)));
  u32(names.length);
  names.forEach((name, index) => {
    u8(name.length, ...Array.from(name, (char) => char.charCodeAt(0)));
    u32(index + 1);
  });
  chunk('HeightMapData', 5, () => {
    u32(3);
    u32(2);
    u32(1);
    u32(1);
    u32(1);
    u32(0);
    u32(6);
    [0, 10, 20, 30, 40, 50].forEach(u16);
  });
  chunk('WorldInfo', 1, () => {
    u16(2);
    key('mapName', 3);
    str('Fords');
    key('weather', 1);
    u32(0);
  });
  chunk('GlobalLighting', 8, () => {
    u32(2);
    for (let index = 0; index < 4 * 9 * 9; index++) {
      f32(index % 9 === 8 ? -1 : 0.5);
    }
    f32(1);
    for (let index = 0; index < 11 + 3; index++) {
      u32(0);
    }
  });
  chunk('ObjectsList', 3, () => {
    for (const [x, template] of [
      [10, 'GondorFarm'],
      [20, '*Waypoints/Waypoint'],
    ] as const) {
      chunk('Object', 3, () => {
        f32(x);
        f32(5);
        f32(0);
        f32(0);
        u32(0);
        str(template);
        u16(1);
        key('objectName', 3);
        str(`obj${x}`);
      });
    }
  });
  chunk('SidesList', 6, () => {
    u8(1);
    u32(1);
    u16(2);
    key('playerName', 3);
    str('Gondor');
    key('isHuman', 0);
    u8(1);
    u32(0);
  });

  return Uint8Array.from(out);
};

suite('Maps', () => {
  test('reads the world info, terrain, lighting, objects and sides', () => {
    const map = parseMap(buildMap());

    assert.deepStrictEqual(map.problems, []);
    assert.deepStrictEqual(
      map.worldInfo?.entries.map((entry) => [entry.key, entry.value.value]),
      [
        ['mapName', 'Fords'],
        ['weather', 0],
      ],
    );
    assert.strictEqual(map.heights?.width, 3);
    assert.deepStrictEqual(
      [...(map.heights?.samples ?? [])],
      [0, 10, 20, 30, 40, 50],
    );
    assert.strictEqual(map.lighting?.timeOfDay, 2);
    assert.deepStrictEqual(
      map.objects.map((object) => [object.template, object.x]),
      [
        ['GondorFarm', 10],
        ['*Waypoints/Waypoint', 20],
      ],
    );
    assert.strictEqual(map.sides[0].entries[0].value.value, 'Gondor');
  });

  test('a compressed map reads the same and writes back compressed', () => {
    const body = buildMap();
    const map = parseMap(compressEar(body));

    assert.strictEqual(map.compression, 'ear');
    assert.deepStrictEqual(map.body, body);
    assert.deepStrictEqual(parseMap(writeMap(map)).body, body);
  });

  test('edits resize the chunks around them and leave the rest as read', () => {
    const body = buildMap();
    let map = parseMap(body);

    map = applyMapEdit(map, {
      kind: 'dict',
      owner: 'world',
      key: 'mapName',
      value: { type: 'string', value: 'The Fords of Isen' },
    });
    map = applyMapEdit(map, {
      kind: 'dict',
      owner: { object: 0 },
      key: 'objectName',
      value: { type: 'string', value: 'farm' },
    });
    map = applyMapEdit(map, {
      kind: 'object',
      index: 1,
      x: 99,
      template: 'RohanFarm',
    });
    map = applyMapEdit(map, { kind: 'timeOfDay', value: 4 });
    map = applyMapEdit(map, {
      kind: 'dict',
      owner: { side: 0 },
      key: 'isHuman',
      value: { type: 'bool', value: false },
    });

    assert.deepStrictEqual(map.problems, []);
    assert.strictEqual(
      map.worldInfo?.entries[0].value.value,
      'The Fords of Isen',
    );
    assert.deepStrictEqual(
      map.objects.map((object) => [
        object.template,
        object.x,
        object.properties.entries[0].value.value,
      ]),
      [
        ['GondorFarm', 10, 'farm'],
        ['RohanFarm', 99, 'obj20'],
      ],
    );
    assert.strictEqual(map.lighting?.timeOfDay, 4);
    assert.strictEqual(map.sides[0].entries[1].value.value, false);
    // The height map before every edit is untouched
    assert.deepStrictEqual(map.body.subarray(0, 200), body.subarray(0, 200));
    assert.throws(
      () =>
        applyMapEdit(map, {
          kind: 'dict',
          owner: 'world',
          key: 'weather',
          value: { type: 'string', value: 'x' },
        }),
      /holds a int/,
    );
  });
});

suite('RefPack', () => {
  test('compressing then decompressing gives the input back', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

    for (const [size, kind] of [
      [0, 0],
      [3, 0],
      [5000, 0],
      [70000, 1],
      [200000, 2],
    ]) {
      const input = new Uint8Array(size);

      for (let index = 0; index < size; index++) {
        input[index] =
          kind === 0
            ? random() & 255
            : kind === 1
              ? (index % 17) * 3
              : index > 200 && random() % 3
                ? input[index - 1 - ((random() % 150000) % index)]
                : random() & 255;
      }

      assert.deepStrictEqual(decompressRefPack(compressRefPack(input)), input);
    }
  });

  test('a stream that copies from before its start is refused', () => {
    assert.throws(
      () =>
        decompressRefPack(Uint8Array.of(0x10, 0xfb, 0, 0, 4, 0x00, 0x05, 0xfc)),
      /copies from/,
    );
  });
});
