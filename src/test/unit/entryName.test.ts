import * as assert from 'assert';
import {
  MAX_ENTRY_PATH_LENGTH,
  findPathClashes,
  getMoveRefusal,
  toArchiveFileName,
  validateEntryName,
  validateEntryPath,
} from '../../core/entryName';

suite('Entry names', () => {
  test('accepts ordinary names, any casing, and Latin-1 letters', () => {
    for (const name of ['a.ini', 'Data', 'My Mod.ini', 'a.b.c', 'café.tga', '.hidden']) {
      assert.strictEqual(validateEntryName(name), undefined, name);
    }
  });

  test('refuses empty and whitespace-only names', () => {
    assert.ok(validateEntryName(''));
    assert.ok(validateEntryName('   '));
    assert.ok(validateEntryName('\t'));
  });

  test('refuses dot names and names that end in a dot', () => {
    assert.ok(validateEntryName('.'));
    assert.ok(validateEntryName('..'));
    assert.ok(validateEntryName('a.'));
  });

  test('refuses leading and trailing spaces', () => {
    assert.ok(validateEntryName(' a.ini'));
    assert.ok(validateEntryName('a.ini '));
  });

  test('refuses both separators', () => {
    assert.ok(validateEntryName('a/b'));
    assert.ok(validateEntryName('a\\b'));
    assert.ok(validateEntryName('/a'));
  });

  test('refuses characters Windows forbids', () => {
    for (const char of '<>:"|?*\u0001') {
      assert.ok(validateEntryName(`a${char}b`), JSON.stringify(char));
    }
  });

  test('refuses Windows device names with or without an extension', () => {
    for (const name of ['CON', 'nul', 'Aux.txt', 'com1', 'LPT9.ini', 'prn.big']) {
      assert.ok(validateEntryName(name), name);
    }

    assert.strictEqual(validateEntryName('console.ini'), undefined);
    assert.strictEqual(validateEntryName('com10'), undefined);
  });

  test('refuses characters the entry table cannot store', () => {
    assert.ok(validateEntryName('€.ini'));
    assert.ok(validateEntryName('日本.ini'));
    assert.ok(validateEntryName('a\u0085b'));
    assert.ok(validateEntryName('a\u{1f600}'));
  });

  test('checks every segment of a path and both separators', () => {
    assert.strictEqual(validateEntryPath('data/ini/object.ini'), undefined);
    assert.strictEqual(validateEntryPath('data\\ini\\object.ini'), undefined);
    assert.ok(validateEntryPath('data/../object.ini'));
    assert.ok(validateEntryPath('data//object.ini'));
    assert.ok(validateEntryPath('/data/object.ini'));
    assert.ok(validateEntryPath('data/object.ini/'));
    assert.ok(validateEntryPath('data/con/object.ini'));
    assert.ok(validateEntryPath('data/ object.ini'));
    assert.ok(validateEntryPath(''));
  });

  test('refuses an overlong path and accepts one at the limit', () => {
    const atLimit = `${'a/'.repeat((MAX_ENTRY_PATH_LENGTH - 1) / 2)}a`;

    assert.strictEqual(atLimit.length, MAX_ENTRY_PATH_LENGTH);
    assert.strictEqual(validateEntryPath(atLimit), undefined);
    assert.ok(validateEntryPath(`${atLimit}b`));
  });

  test('turns a typed archive name into a .big file name', () => {
    assert.deepStrictEqual(toArchiveFileName(' mod '), { name: 'mod.big' });
    assert.deepStrictEqual(toArchiveFileName('mod.BIG'), { name: 'mod.BIG' });
    assert.ok('error' in toArchiveFileName(''));
    assert.ok('error' in toArchiveFileName('.big'));
    assert.ok('error' in toArchiveFileName('a/b'));
    assert.ok('error' in toArchiveFileName('con'));
    assert.ok('error' in toArchiveFileName('a:b'));
  });
});

suite('Path clashes', () => {
  test('reports a path repeated, ignoring case', () => {
    assert.deepStrictEqual(findPathClashes(['a/b.ini', 'A/B.INI']), [
      { path: 'A/B.INI', reason: 'The same path is added twice.' },
    ]);
  });

  test('reports a file and a folder claiming one path, in either order', () => {
    assert.strictEqual(findPathClashes(['a', 'a/b.ini']).length, 1);
    assert.strictEqual(findPathClashes(['a/b.ini', 'a']).length, 1);
    assert.strictEqual(findPathClashes(['A', 'a/b.ini']).length, 1);
  });

  test('leaves siblings and cousins alone', () => {
    assert.deepStrictEqual(
      findPathClashes(['a/b.ini', 'a/c.ini', 'ab/b.ini', 'a/d/e.ini']),
      [],
    );
  });
});

suite('Move refusals', () => {
  test('refuses a move onto itself or into its own child', () => {
    assert.strictEqual(getMoveRefusal('a/b', 'a/b'), 'itself');
    assert.strictEqual(getMoveRefusal('a/b', 'A/B'), 'itself');
    assert.strictEqual(getMoveRefusal('a/b', 'a/b/c'), 'inside');
    assert.strictEqual(getMoveRefusal('a', 'a/b/c'), 'inside');
  });

  test('refuses a move into the folder the entry is already in', () => {
    assert.strictEqual(getMoveRefusal('a/b.ini', 'a'), 'sameFolder');
    assert.strictEqual(getMoveRefusal('b.ini', ''), 'sameFolder');
  });

  test('allows a move elsewhere, and into a folder that merely shares a prefix', () => {
    assert.strictEqual(getMoveRefusal('a/b.ini', ''), undefined);
    assert.strictEqual(getMoveRefusal('a', 'ab'), undefined);
    assert.strictEqual(getMoveRefusal('a', ''), 'sameFolder');
    assert.strictEqual(getMoveRefusal('a/b', 'c'), undefined);
  });
});
