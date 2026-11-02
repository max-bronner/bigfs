import * as assert from 'assert';
import { rankFiles } from '../../core/rankFiles';
import { buildGameTree } from '../../game/install/gameView';
import { listFileCopies } from '../../game/install/listFileCopies';

suite('File copies in the game view', () => {
  test('every archive holding a path is listed and the one the game loads is marked', () => {
    const root = buildGameTree([
      { entryPath: 'data/ini/object.ini', ref: 'mod', origin: '___test.big' },
      { entryPath: 'Data/INI/Object.ini', ref: 'base', origin: 'INI.big' },
      { entryPath: 'data/ini/weapon.ini', ref: 'base', origin: 'INI.big' },
    ]);
    const copies = listFileCopies(root);
    const object = copies.filter(
      (copy) => copy.name.toLowerCase() === 'object.ini',
    );

    assert.strictEqual(copies.length, 3);
    assert.deepStrictEqual(
      object.map((copy) => [copy.origin, copy.isLoaded, copy.copies]),
      [
        ['___test.big', true, 2],
        ['INI.big', false, 2],
      ],
    );
    assert.strictEqual(object[1].loadedFrom, '___test.big');
    assert.strictEqual(
      copies.find((copy) => copy.name === 'weapon.ini')!.copies,
      1,
    );
  });
});

suite('Ranking files for the finder', () => {
  const file = (path: string, isPreferred = true) => ({
    name: path.split('/').at(-1)!,
    path,
    key: path,
    isPreferred,
  });

  test('without a query only the recent files are offered, newest first', () => {
    const files = [file('a/one.ini'), file('a/two.ini'), file('a/three.ini')];

    assert.deepStrictEqual(
      rankFiles('', files, ['a/three.ini', 'gone.ini', 'a/one.ini'], 10).map(
        (entry) => entry.key,
      ),
      ['a/three.ini', 'a/one.ini'],
    );
  });

  test('a recent file edges ahead of an equal match, and the preferred copy wins a tie', () => {
    const files = [file('a/item.ini'), file('b/item.ini')];

    assert.strictEqual(
      rankFiles('item', files, ['b/item.ini'], 10)[0].key,
      'b/item.ini',
    );

    const copies = [file('x/item.ini', false), file('y/item.ini', true)];

    assert.strictEqual(rankFiles('item', copies, [], 10)[0].key, 'y/item.ini');
  });

  test('the list stops at the limit', () => {
    const files = Array.from({ length: 50 }, (_, index) =>
      file(`a/item${index}.ini`),
    );

    assert.strictEqual(rankFiles('item', files, [], 7).length, 7);
  });
});
