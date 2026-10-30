import * as assert from 'assert';
import {
  getArchiveOrderKey,
  buildGameTree,
  getGameFiles,
} from '../../game/install/gameView';
import type { GameFile } from '../../game/install/gameView';

/** Builds a candidate game file whose ref names its origin and entry path */
const toGameFile = (entryPath: string, origin: string): GameFile<string> => ({
  entryPath,
  origin,
  ref: `${origin}:${entryPath}`,
});

suite('Game view', () => {
  test('orders archives as the engine does: _ before letters, without casing', () => {
    const archives = ['INI.big', '___test.big', 'Data/English.big', 'apt.big'];

    assert.deepStrictEqual(
      archives.sort((a, b) =>
        getArchiveOrderKey(a) < getArchiveOrderKey(b) ? -1 : 1,
      ),
      ['___test.big', 'apt.big', 'Data/English.big', 'INI.big'],
    );
  });

  test('the first copy of a path wins and the rest are shadowed, casing aside', () => {
    const root = buildGameTree([
      toGameFile('data/ini/object.ini', 'loose'),
      toGameFile('Data/INI/Object.ini', '___test.big'),
      toGameFile('data/ini/object.ini', 'INI.big'),
      toGameFile('data/ini/weapon.ini', 'INI.big'),
    ]);
    const object = root.children
      ?.get('data')
      ?.children?.get('ini')
      ?.children?.get('object.ini');

    assert.strictEqual(object?.winner?.origin, 'loose');
    assert.deepStrictEqual(
      object?.shadowed?.map((copy) => copy.origin),
      ['___test.big', 'INI.big'],
    );
    assert.deepStrictEqual(
      getGameFiles(root).map((node) => node.path),
      ['data/ini/object.ini', 'data/ini/weapon.ini'],
    );
  });

  test('a file never shadows a directory of the same path, or the reverse', () => {
    const root = buildGameTree([
      toGameFile('art/textures', 'a.big'),
      toGameFile('art/textures/unit.dds', 'b.big'),
    ]);

    assert.strictEqual(
      root.children?.get('art')?.children?.get('textures')?.winner?.origin,
      'a.big',
    );
    assert.deepStrictEqual(
      getGameFiles(root).map((node) => node.path),
      ['art/textures'],
    );
  });
});
