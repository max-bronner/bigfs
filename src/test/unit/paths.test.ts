import * as assert from 'assert';
import {
  getAvailableName,
  getParentPath,
  isPathBelow,
  movePath,
  splitPath,
} from '../../common/paths';

suite('Path helpers', () => {
  test('getParentPath returns the parent or an empty string', () => {
    assert.strictEqual(
      getParentPath('/archive.big/data/a.ini'),
      '/archive.big/data',
    );
    assert.strictEqual(getParentPath('/archive.big'), '');
    assert.strictEqual(getParentPath('data/a.ini'), 'data');

    // An entry path without a parent keeps its name intact
    assert.strictEqual(getParentPath('a.ini'), '');
  });

  test('splitPath drops empty segments', () => {
    assert.deepStrictEqual(splitPath('/archive.big/data/a.ini'), [
      'archive.big',
      'data',
      'a.ini',
    ]);
    assert.deepStrictEqual(splitPath('data//a.ini'), ['data', 'a.ini']);
    assert.deepStrictEqual(splitPath(''), []);
  });

  test('isPathBelow matches the path itself and its descendants only', () => {
    assert.ok(isPathBelow('data/a.ini', 'data/a.ini'));
    assert.ok(isPathBelow('data/sub/a.ini', 'data'));
    assert.ok(!isPathBelow('database/a.ini', 'data'));
    assert.ok(!isPathBelow('data', 'data/sub'));
  });

  test('movePath repoints a path below a new parent', () => {
    assert.strictEqual(
      movePath('data/a.ini', 'data/a.ini', 'art/b.ini'),
      'art/b.ini',
    );
    assert.strictEqual(
      movePath('data/sub/a.ini', 'data', 'art'),
      'art/sub/a.ini',
    );
  });

  test('getAvailableName appends numbered copy suffixes', () => {
    const takenNames = new Set(['a.ini', 'a copy.ini', 'a copy 2.ini']);

    assert.strictEqual(getAvailableName(takenNames, 'b.ini'), 'b.ini');
    assert.strictEqual(getAvailableName(takenNames, 'a.ini'), 'a copy 3.ini');
    assert.strictEqual(
      getAvailableName(new Set(['plain']), 'plain'),
      'plain copy',
    );
  });
});
