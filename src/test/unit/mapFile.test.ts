import * as assert from 'assert';
import { parseMap, writeMap } from '../../formats/map/mapFile';
import { applyMapEdit } from '../../formats/map/mapEdit';
import { buildMap } from './mapSynth';
import {
  compressEar,
  compressRefPack,
  decompressRefPack,
} from '../../formats/refpack/refpack';

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

suite('Map string values', () => {
  const rename = (value: string) =>
    parseMap(
      writeMap(
        applyMapEdit(parseMap(buildMap()), {
          kind: 'dict',
          owner: 'world',
          key: 'mapName',
          value: { type: 'string', value },
        }),
      ),
    );

  test('a curly apostrophe or euro sign is saved as its Windows-1252 byte', () => {
    for (const text of ['Helm’s Deep', '€5 “quoted” – done', 'café']) {
      const map = rename(text);

      assert.deepStrictEqual(map.problems, []);
      assert.strictEqual(map.worldInfo?.entries[0].value.value, text);
    }
  });

  test('a character outside Windows-1252 is refused', () => {
    assert.throws(() => rename('Fords of Isen 日本'), /Windows-1252/);
  });
});

suite('Map scripts, teams and areas', () => {
  test('are read with their names, flags and calls', () => {
    const map = parseMap(buildMap());

    assert.deepStrictEqual(map.problems, []);
    assert.strictEqual(map.teams[0].entries[0].value.value, 'teamGondor');
    assert.deepStrictEqual(map.triggerAreas, [
      {
        name: 'Ford',
        layerName: '',
        trailing: 0,
        id: 7,
        points: [
          [0, 0],
          [100, 0],
          [50, 80],
        ],
      },
    ]);

    const [group] = map.scripts[0];

    assert.ok(group.kind === 'group' && group.active);

    const [script] = group.children;

    assert.ok(script.kind === 'script');
    assert.deepStrictEqual(
      [
        script.name,
        script.oneShot,
        script.difficulties,
        script.conditions,
        script.actions,
      ],
      [
        'SayHello',
        true,
        ['easy', 'normal'],
        [[{ name: 'CONDITION_TRUE', parameters: ['0'] }]],
        [{ name: 'DEBUG_STRING', parameters: ['hello'] }],
      ],
    );
  });

  test('a script switches off and a light changes in place', () => {
    let map = parseMap(buildMap());
    const script = (map.scripts[0][0] as { children: { activeAt: number }[] })
      .children[0];
    const length = map.body.length;

    map = applyMapEdit(map, {
      kind: 'scriptActive',
      at: script.activeAt,
      active: false,
    });
    map = applyMapEdit(map, {
      kind: 'light',
      config: 1,
      field: 'color',
      value: [1, 0.5, 0.25],
    });
    map = applyMapEdit(map, {
      kind: 'dict',
      owner: { team: 0 },
      key: 'teamName',
      value: { type: 'string', value: 'teamRohan' },
    });

    assert.strictEqual(map.body.length, length - 1);
    assert.strictEqual(
      (map.scripts[0][0] as { children: { active: boolean }[] }).children[0]
        .active,
      false,
    );
    assert.deepStrictEqual(map.lighting?.terrainSuns[1].color, [1, 0.5, 0.25]);
    assert.strictEqual(map.teams[0].entries[0].value.value, 'teamRohan');
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

  test('a truncated map fails with a message', () => {
    const body = buildMap();

    assert.throws(() => parseMap(body.slice(0, 6)), /Map data ends early at 4/);
    assert.throws(() => parseMap(body.slice(0, 20)), /Map data ends early/);
  });
});
