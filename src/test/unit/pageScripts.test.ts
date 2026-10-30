import * as assert from 'assert';
import { WND_PREVIEW_SCRIPT } from '../../features/wnd/wndPreviewScript';
import { BALANCE_SHEET_SCRIPT } from '../../features/balanceSheet/balanceSheetScript';
import {
  describeBling,
  describeChecksum,
  describePoints,
  describePower,
  describeVersion,
} from '../../webview/cah/heroText';
import {
  filterObjects,
  idOf,
  insidePolygon,
  isStart,
  nameOf,
  parseValue,
  projectToCanvas,
  shadeRelief,
  turnedAngle,
  unprojectFromCanvas,
  waypointsById,
} from '../../webview/map/mapModel';
import { describeMode, nextAreaName } from '../../webview/map/modeText';
import type { ObjectView } from '../../webview/map/protocol';
import {
  countScripts,
  describePlayerList,
  describeScript,
} from '../../webview/shared/scriptTreeText';
import type { ScriptTreeNode } from '../../webview/shared/scriptTreeText';
import { editorRows, isEdited } from '../../webview/strings/cellText';
import {
  describeCount,
  filterRows,
  matchesFilter,
} from '../../webview/strings/rowFilter';

const waypoint = (id: number, name: string): ObjectView => ({
  index: id,
  x: 0,
  y: 0,
  z: 0,
  angle: 0,
  template: '*Waypoints/Waypoint',
  properties: [
    { key: 'waypointID', value: { type: 'int', value: id } },
    { key: 'waypointName', value: { type: 'string', value: name } },
  ],
});

const script = (
  name: string,
  extra: Partial<Extract<ScriptTreeNode, { kind: 'script' }>> = {},
): ScriptTreeNode => ({
  kind: 'script',
  name,
  comment: '',
  active: true,
  activeAt: 0,
  oneShot: false,
  difficulties: ['easy', 'medium', 'hard'],
  subroutine: false,
  conditions: [],
  actions: [],
  actionsFalse: [],
  ...extra,
});

suite('Page scripts', () => {
  // These two pages are still template literals, where a stray escape breaks the page silently
  test('every inlined webview script parses', () => {
    for (const script of [BALANCE_SHEET_SCRIPT, WND_PREVIEW_SCRIPT]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });

  suite('map page', () => {
    test('a start position is a waypoint named for a player', () => {
      assert.strictEqual(isStart(waypoint(1, 'Player_2_Start')), true);
      assert.strictEqual(isStart(waypoint(1, 'Rally')), false);
      assert.strictEqual(nameOf(waypoint(1, 'Rally')), 'Rally');
    });

    test('waypoints are found by id and the first of a repeated id wins', () => {
      const first = waypoint(3, 'A');
      const found = waypointsById([first, waypoint(3, 'B'), waypoint(4, 'C')]);

      assert.strictEqual(found.get(3), first);
      assert.strictEqual(idOf(first), 3);
      assert.deepStrictEqual([...found.keys()], [3, 4]);
    });

    test('typed text is read as a value of the dictionary type', () => {
      assert.deepStrictEqual(parseValue('bool', 'Yes'), {
        type: 'bool',
        value: true,
      });
      assert.strictEqual(parseValue('bool', 'maybe'), undefined);
      assert.deepStrictEqual(parseValue('int', '12'), { type: 'int', value: 12 });
      assert.strictEqual(parseValue('int', '1.5'), undefined);
      assert.strictEqual(parseValue('real', ' '), undefined);
      assert.deepStrictEqual(parseValue('wide', 'x'), { type: 'wide', value: 'x' });
    });

    test('a point is inside a polygon by the even-odd rule', () => {
      const square: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ];

      assert.strictEqual(insidePolygon([5, 5], square), true);
      assert.strictEqual(insidePolygon([15, 5], square), false);
    });

    test('world units project to canvas pixels and back', () => {
      const heights = {
        width: 100,
        height: 50,
        border: 5,
        boundaries: [],
        samples: [],
      };
      const size = { width: 200, height: 100 };
      const [px, py] = projectToCanvas(heights, size, 100, 40);

      assert.deepStrictEqual([px, py], [30, 100 - 18]);
      const [x, y] = unprojectFromCanvas(heights, size, px, py);

      assert.ok(Math.abs(x - 100) < 1e-9 && Math.abs(y - 40) < 1e-9);
    });

    test('the relief is shaded top row first with the height range', () => {
      const relief = shadeRelief({
        width: 2,
        height: 2,
        border: 0,
        boundaries: [],
        samples: [0, 10, 0, 10],
      });

      assert.strictEqual(relief.low, 0);
      assert.strictEqual(relief.high, 10);
      assert.strictEqual(relief.pixels.length, 16);
      assert.ok(relief.pixels.every((value, at) => at % 4 !== 3 || value === 255));
    });

    test('an angle turns within minus pi and pi', () => {
      assert.ok(Math.abs(turnedAngle(Math.PI - 0.1, 0.2) - (-Math.PI + 0.1)) < 1e-9);
      assert.strictEqual(turnedAngle(0, 0.5), 0.5);
    });

    test('the object filter matches template and name', () => {
      const objects = [waypoint(1, 'Rally'), waypoint(2, 'Camp')];

      assert.strictEqual(filterObjects(objects, 'RAL').length, 1);
      assert.strictEqual(filterObjects(objects, '').length, 2);
      assert.strictEqual(filterObjects(objects, 'waypoints/').length, 2);
    });

    test('a new area takes the first free number and the hint follows the mode', () => {
      assert.strictEqual(nextAreaName(new Set()), 'Area 1');
      assert.strictEqual(nextAreaName(new Set(['Area 2', 'Other'])), 'Area 3');
      assert.strictEqual(describeMode(undefined), '');
      assert.ok(
        describeMode({ kind: 'place', template: 'Orc', waypoint: false }).includes('place Orc'),
      );
    });
  });

  suite('script tree', () => {
    test('scripts are counted through groups, groups not included', () => {
      const group: ScriptTreeNode = {
        kind: 'group',
        name: 'G',
        active: true,
        activeAt: 0,
        subroutine: false,
        children: [script('a'), script('b')],
      };

      assert.strictEqual(countScripts([group, script('c')]), 3);
    });

    test('a script label lists what sets it apart', () => {
      assert.strictEqual(describeScript(script('Plain') as never), 'Plain');
      assert.strictEqual(
        describeScript(
          script('Odd', {
            oneShot: true,
            subroutine: true,
            difficulties: ['easy', 'hard'],
          }) as never,
        ),
        'Odd · once · subroutine · easy/hard',
      );
    });

    test('a player list is named by the player, else by its place', () => {
      const list = [script('a')];
      const named = [{ key: 'playerName', value: { value: 'Mordor' } }];

      assert.strictEqual(describePlayerList(list, named, 0, true), 'Mordor (1)');
      assert.strictEqual(describePlayerList(list, [], 1, true), 'Player 2 (1)');
      assert.strictEqual(
        describePlayerList(list, undefined, 0, false),
        'Script list 1 (1)',
      );
    });
  });

  suite('string table page', () => {
    const rows = [
      { id: 0, label: 'GUI:Hello', text: 'World' },
      { id: 1, label: 'GUI:Bye', text: 'Moon', speech: 'Farewell' },
    ];

    test('the filter matches label, text and speech', () => {
      assert.strictEqual(filterRows(rows, 'hello').length, 1);
      assert.strictEqual(filterRows(rows, 'MOON').length, 1);
      assert.strictEqual(filterRows(rows, 'farewell')[0].id, 1);
      assert.strictEqual(filterRows(rows, '').length, 2);
      assert.strictEqual(matchesFilter(rows[0], 'zzz'), false);
    });

    test('the count says how many labels the filter keeps', () => {
      assert.strictEqual(describeCount(2, 2), '2 labels');
      assert.strictEqual(describeCount(1, 2), '1 of 2 labels');
    });

    test('LF text read back from a field is not an edit of CRLF text', () => {
      assert.strictEqual(isEdited('a\r\nb', 'a\nb'), false);
      assert.strictEqual(isEdited('a\r\nb', 'a\nc'), true);
      assert.strictEqual(editorRows('one'), 2);
      assert.strictEqual(editorRows('1\n2\n3'), 3);
    });
  });

  suite('hero page', () => {
    test('points read spent of total, or say what is missing', () => {
      assert.ok(describePoints({ total: 10, spent: 4 }).startsWith('4 of 10 spent'));
      assert.ok(describePoints({ total: undefined, spent: 0 }).startsWith('The subclass'));
      assert.ok(describePoints(undefined).startsWith('Not stored'));
    });

    test('a power and a bling are described by what resolved', () => {
      assert.strictEqual(
        describePower({
          slot: 0,
          button: 'B',
          level: 1,
          commandSlot: 1,
          label: 'Fire',
          specialPower: 'SP',
          specialPowerKnown: false,
        }),
        'Fire, special power SP (not found)',
      );
      assert.strictEqual(
        describeBling({
          at: 0,
          group: 'g',
          index: 0,
          binder: 'Look',
          kind: 'appearance',
          label: 'Hat',
        }),
        'Look - appearance - Hat',
      );
    });

    test('the checksum and version lines match the file', () => {
      assert.strictEqual(
        describeChecksum({ storedCrc: 0xab, document: false, crc: 0xcd, trailing: 0 }),
        'stored 000000ab, will save as 000000cd',
      );
      assert.strictEqual(
        describeChecksum({ storedCrc: undefined, document: true, crc: 1, trailing: 0 }),
        'none stored, will save as 00000001',
      );
      assert.strictEqual(describeVersion(7), '7 (saving writes version 8)');
      assert.strictEqual(describeVersion(8), '8');
    });
  });
});
