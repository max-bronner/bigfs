import * as assert from 'assert';
import { overrideReport, skippedFromPackage } from '../../model/modPackage';

const BASE = [
  {
    path: 'INI.big',
    entries: new Set(['data/ini/weapon.ini', 'data/ini/object.ini']),
  },
  { path: '_patch.big', entries: new Set(['data/ini/weapon.ini']) },
];
const FILES = [
  'data/ini/weapon.ini',
  'Data/INI/Object.ini',
  'data/ini/mine.ini',
];

suite('Mod packages', () => {
  test('in the game folder the archive name decides what overrides', () => {
    // `zz` sorts after both: every base file stays
    assert.deepStrictEqual(
      overrideReport(FILES, 'zzMod.big', BASE, 'gameFolder'),
      {
        added: ['data/ini/mine.ini'],
        overrides: [],
        ignored: [
          { path: 'data/ini/weapon.ini', keptBy: '_patch.big' },
          { path: 'Data/INI/Object.ini', keptBy: 'INI.big' },
        ],
      },
    );
    // `!` sorts before both
    assert.deepStrictEqual(
      overrideReport(FILES, '!Mod.big', BASE, 'gameFolder').overrides,
      [
        { path: 'data/ini/weapon.ini', over: ['_patch.big', 'INI.big'] },
        { path: 'Data/INI/Object.ini', over: ['INI.big'] },
      ],
    );
  });

  test('with -mod it wins whatever its name', () => {
    assert.strictEqual(
      overrideReport(FILES, 'zzMod.big', BASE, 'modFolder').ignored.length,
      0,
    );
  });

  test('hidden files and archives are not packed', () => {
    assert.deepStrictEqual(
      ['.git/config', 'data/.hidden', 'old.big', 'data/ini/a.ini'].map(
        skippedFromPackage,
      ),
      [true, true, true, false],
    );
  });
});
