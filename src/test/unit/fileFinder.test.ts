import * as assert from 'assert';
import { matchFuzzy } from '../../core/matchFuzzy';
import { scoreFilePath } from '../../core/scoreFilePath';

const rank = (query: string, files: string[]): string[] =>
  files
    .map((file) => ({
      file,
      score: scoreFilePath(query, file.split('/').at(-1)!, file),
    }))
    .filter((entry) => entry.score !== undefined)
    .sort((a, b) => b.score! - a.score!)
    .map((entry) => entry.file);

suite('Fuzzy file matching', () => {
  test('characters must follow each other in order', () => {
    assert.ok(matchFuzzy('obj', 'object.ini'));
    assert.ok(matchFuzzy('oini', 'object.ini'));
    assert.strictEqual(matchFuzzy('jbo', 'object.ini'), undefined);
    assert.strictEqual(matchFuzzy('zzz', 'object.ini'), undefined);
  });

  test('casing is ignored and the matched positions are reported', () => {
    assert.deepStrictEqual(
      matchFuzzy('OBJ', 'object.ini')?.positions,
      [0, 1, 2],
    );
    assert.deepStrictEqual(matchFuzzy('oi', 'object.ini')?.positions, [0, 7]);
  });

  test('a match at the start of the name beats one in the middle', () => {
    const files = [
      'data/ini/xobject.ini',
      'data/ini/object.ini',
      'data/ini/myobject.ini',
    ];

    assert.strictEqual(rank('obj', files)[0], 'data/ini/object.ini');
  });

  test('consecutive characters and word starts beat scattered ones', () => {
    const files = [
      'data/gondorfighter.ini',
      'data/g_o_n_d_o_r.ini',
      'data/great_old_nest.ini',
    ];

    assert.strictEqual(rank('gondor', files)[0], 'data/gondorfighter.ini');
    assert.strictEqual(
      matchFuzzy('gon', 'the_great_object_name')!.positions[0],
      4,
    );
  });

  test('a match in the file name outranks one found only in the folders', () => {
    const files = ['data/objects/readme.txt', 'art/obj.txt'];

    assert.strictEqual(rank('obj', files)[0], 'art/obj.txt');
  });

  test('a query with a slash is matched against the whole path', () => {
    const files = ['data/ini/object.ini', 'art/ini/object.ini'];

    assert.deepStrictEqual(rank('data/ini/obj', files), [
      'data/ini/object.ini',
    ]);
    assert.deepStrictEqual(rank('data\\ini\\obj', files), [
      'data/ini/object.ini',
    ]);
  });

  test('an exact name is first', () => {
    const files = ['a/object.ini.bak', 'a/object.ini', 'a/objects.ini'];

    assert.strictEqual(rank('object.ini', files)[0], 'a/object.ini');
  });

  test('an overlong target keeps the tail, where the file name is', () => {
    assert.ok(matchFuzzy('name.ini', `${'x/'.repeat(600)}name.ini`));
  });
});
