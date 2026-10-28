import * as assert from 'assert';
import { MapEdit, applyMapEdit } from '../../formats/map/mapEdit';
import { MapFile, parseMap, writeMap } from '../../formats/map/mapFile';
import { compressEar } from '../../formats/refpack';
import { buildMap } from './mapSynth';

const waypoint = (id: number, x: number): MapEdit => ({
  kind: 'objectAdd',
  template: '*Waypoints/Waypoint',
  x,
  y: 1,
  properties: [
    { key: 'waypointID', value: { type: 'int', value: id } },
    { key: 'waypointName', value: { type: 'string', value: `W${id}` } },
  ],
});

/** The chunk's bytes with its header, as the map stores it */
const chunkBytes = (map: MapFile, name: string) => {
  const chunk = map.chunks.find((candidate) => candidate.name === name);

  assert.ok(chunk, `${name} is there`);

  return map.body.slice(chunk.header, chunk.end);
};

const UNTOUCHED = ['HeightMapData', 'WorldInfo', 'GlobalLighting', 'Teams'];

suite('Map objects', () => {
  test('a placed object is read back and no other chunk changes', () => {
    const before = parseMap(buildMap());
    const after = applyMapEdit(before, {
      kind: 'objectAdd',
      template: 'GondorBarracks',
      x: 100,
      y: 200,
      angle: 1.5,
      properties: [
        { key: 'objectName', value: { type: 'string', value: 'rax' } },
        { key: 'objectInitialHealth', value: { type: 'int', value: 80 } },
      ],
    });

    assert.deepStrictEqual(after.problems, []);
    assert.strictEqual(after.objects.length, 3);

    const added = after.objects[2];

    assert.deepStrictEqual(
      [added.template, added.x, added.y, added.angle],
      ['GondorBarracks', 100, 200, 1.5],
    );
    assert.deepStrictEqual(
      added.properties.entries.map((entry) => [entry.key, entry.value.value]),
      [
        ['objectName', 'rax'],
        ['objectInitialHealth', 80],
      ],
    );
    assert.deepStrictEqual(
      after.objects.slice(0, 2).map((object) => object.template),
      ['GondorFarm', '*Waypoints/Waypoint'],
    );

    for (const name of UNTOUCHED) {
      assert.deepStrictEqual(chunkBytes(after, name), chunkBytes(before, name));
    }
    assert.deepStrictEqual(
      after.scripts[0][0].kind === 'group' && after.scripts[0][0].name,
      'Intro',
    );
  });

  test('a new name goes into the name table and the map reads again', () => {
    const before = parseMap(buildMap());
    const after = applyMapEdit(before, waypoint(1, 5));

    assert.ok([...after.names.values()].includes('waypointID'));
    assert.strictEqual(after.names.size, before.names.size + 2);
    assert.deepStrictEqual(after.problems, []);
    assert.strictEqual(
      parseMap(writeMap(after)).objects[2].properties.entries[0].key,
      'waypointID',
    );
  });

  test('a deleted object leaves the others as they were', () => {
    const before = parseMap(buildMap());
    const after = applyMapEdit(before, { kind: 'objectDelete', index: 0 });

    assert.deepStrictEqual(after.problems, []);
    assert.deepStrictEqual(
      after.objects.map((object) => object.template),
      ['*Waypoints/Waypoint'],
    );
    assert.deepStrictEqual(
      after.objects[0].properties.entries[0].value.value,
      'obj20',
    );
    for (const name of UNTOUCHED) {
      assert.deepStrictEqual(chunkBytes(after, name), chunkBytes(before, name));
    }
    assert.throws(
      () => applyMapEdit(after, { kind: 'objectDelete', index: 5 }),
      /no such object/,
    );
  });

  test('moving and turning writes the four floats in place', () => {
    const before = parseMap(buildMap());
    const after = applyMapEdit(before, {
      kind: 'object',
      index: 0,
      x: 7,
      y: 8,
      angle: -2,
    });

    assert.strictEqual(after.body.length, before.body.length);
    assert.deepStrictEqual(
      [
        after.objects[0].x,
        after.objects[0].y,
        after.objects[0].z,
        after.objects[0].angle,
      ],
      [7, 8, 0, -2],
    );
    assert.deepStrictEqual(
      [after.objects[1].x, after.objects[1].template],
      [before.objects[1].x, before.objects[1].template],
    );
    assert.throws(
      () => applyMapEdit(before, { kind: 'object', index: 0, x: NaN }),
      /must be a number/,
    );
  });

  test('a property is set, added and removed, and a wrong type is refused', () => {
    let map = parseMap(buildMap());
    const owner = { object: 0 };

    map = applyMapEdit(map, {
      kind: 'property',
      owner,
      key: 'originalOwner',
      value: { type: 'string', value: 'Gondor/teamGondor' },
    });
    map = applyMapEdit(map, {
      kind: 'property',
      owner,
      key: 'objectName',
      value: { type: 'string', value: 'keep' },
    });

    assert.deepStrictEqual(
      map.objects[0].properties.entries.map((entry) => [
        entry.key,
        entry.value.value,
      ]),
      [
        ['objectName', 'keep'],
        ['originalOwner', 'Gondor/teamGondor'],
      ],
    );

    map = applyMapEdit(map, {
      kind: 'property',
      owner,
      key: 'objectName',
      value: null,
    });

    assert.deepStrictEqual(
      map.objects[0].properties.entries.map((entry) => entry.key),
      ['originalOwner'],
    );
    assert.strictEqual(
      map.objects[1].properties.entries[0].value.value,
      'obj20',
    );
    assert.throws(
      () =>
        applyMapEdit(map, {
          kind: 'property',
          owner,
          key: 'originalOwner',
          value: { type: 'int', value: 1 },
        }),
      /holds a string/,
    );
    assert.throws(
      () =>
        applyMapEdit(map, {
          kind: 'property',
          owner,
          key: 'objectInitialHealth',
          value: { type: 'int', value: 1.5 },
        }),
      /does not hold/,
    );
  });

  test('a compressed map is saved compressed with the object in it', () => {
    const map = applyMapEdit(parseMap(compressEar(buildMap())), {
      kind: 'objectDelete',
      index: 1,
    });
    const again = parseMap(writeMap(map));

    assert.strictEqual(again.compression, 'ear');
    assert.strictEqual(again.objects.length, 1);
  });
});

suite('Map waypoints', () => {
  const withWaypoints = () => {
    let map = parseMap(buildMap());

    for (const [id, x] of [
      [1, 10],
      [2, 20],
      [3, 30],
    ]) {
      map = applyMapEdit(map, waypoint(id, x));
    }

    return map;
  };

  test('a link creates the chunk, survives a save and can be removed', () => {
    let map = withWaypoints();

    assert.deepStrictEqual(map.waypointLinks, []);

    map = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 1,
      to: 2,
      present: true,
    });
    map = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 2,
      to: 3,
      present: true,
    });
    map = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 2,
      to: 3,
      present: true,
    });

    const saved = parseMap(writeMap(map));

    assert.deepStrictEqual(saved.problems, []);
    assert.deepStrictEqual(saved.waypointLinks, [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);

    map = applyMapEdit(saved, {
      kind: 'waypointLink',
      from: 1,
      to: 2,
      present: false,
    });

    assert.deepStrictEqual(map.waypointLinks, [{ from: 2, to: 3 }]);
    assert.throws(
      () =>
        applyMapEdit(map, {
          kind: 'waypointLink',
          from: 1,
          to: 9,
          present: true,
        }),
      /in the map/,
    );
    assert.throws(
      () =>
        applyMapEdit(map, {
          kind: 'waypointLink',
          from: 2,
          to: 2,
          present: true,
        }),
      /itself/,
    );
  });

  test('deleting a waypoint drops its links and keeps the others', () => {
    let map = withWaypoints();

    map = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 1,
      to: 2,
      present: true,
    });
    map = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 2,
      to: 3,
      present: true,
    });

    const index = map.objects.findIndex(
      (object) => object.properties.entries[0].value.value === 2,
    );

    map = applyMapEdit(map, { kind: 'objectDelete', index });

    assert.deepStrictEqual(map.problems, []);
    assert.deepStrictEqual(map.waypointLinks, []);
    assert.strictEqual(map.objects.length, 4);
  });

  test('a links chunk of unknown shape is kept, not rewritten', () => {
    const map = withWaypoints();
    const linked = applyMapEdit(map, {
      kind: 'waypointLink',
      from: 1,
      to: 2,
      present: true,
    });
    const chunk = linked.waypointLinksChunk;

    assert.ok(chunk);

    // A count the chunk cannot hold makes it unreadable
    const body = linked.body.slice();

    new DataView(body.buffer).setUint32(chunk.start, 5, true);

    const broken = parseMap(body);

    assert.ok(
      broken.problems.some((problem) => problem.startsWith('WaypointsList')),
    );
    assert.throws(
      () =>
        applyMapEdit(broken, {
          kind: 'waypointLink',
          from: 1,
          to: 3,
          present: true,
        }),
      /kept/,
    );
  });
});

suite('Map trigger areas', () => {
  test('an area is renamed and reshaped and the others are written as read', () => {
    const before = parseMap(buildMap());
    const first = chunkBytes(before, 'TriggerAreas');
    const same = applyMapEdit(before, {
      kind: 'areaSet',
      index: 0,
    });

    assert.deepStrictEqual(chunkBytes(same, 'TriggerAreas'), first);

    const after = applyMapEdit(before, {
      kind: 'areaSet',
      index: 0,
      name: 'Ford North',
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    });

    assert.deepStrictEqual(after.problems, []);
    assert.strictEqual(after.triggerAreas[0].name, 'Ford North');
    assert.strictEqual(after.triggerAreas[0].id, 7);
    assert.strictEqual(after.triggerAreas[0].points.length, 4);
    for (const name of UNTOUCHED) {
      assert.deepStrictEqual(chunkBytes(after, name), chunkBytes(before, name));
    }
    assert.strictEqual(after.scripts[0].length, before.scripts[0].length);
  });

  test('an area is added with the next id and deleted again', () => {
    const before = parseMap(buildMap());
    const added = applyMapEdit(before, {
      kind: 'areaAdd',
      name: 'Camp',
      points: [
        [1, 1],
        [2, 1],
        [2, 2],
      ],
    });

    assert.deepStrictEqual(
      added.triggerAreas.map((area) => [area.name, area.id]),
      [
        ['Ford', 7],
        ['Camp', 8],
      ],
    );

    const removed = applyMapEdit(added, { kind: 'areaDelete', index: 0 });

    assert.deepStrictEqual(
      removed.triggerAreas.map((area) => area.name),
      ['Camp'],
    );
    assert.throws(
      () =>
        applyMapEdit(before, {
          kind: 'areaAdd',
          name: 'Line',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      /three points/,
    );
    assert.throws(
      () =>
        applyMapEdit(before, {
          kind: 'areaAdd',
          name: ' ',
          points: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
        }),
      /needs a name/,
    );
  });
});
