import * as assert from 'assert';
import { findConflicts, planTransfer } from '../../game/install/transferPlan';

const items = (...paths: string[]) => paths.map((path) => ({ path }));
const content = (files: string[], directories: string[] = []) => ({
  files,
  directories,
});

suite('transfer planning', () => {
  test('files with free names land where they are named', () => {
    const plan = planTransfer(
      items('a.ini', 'sub/b.ini'),
      content(['other.ini']),
      'replace',
    );

    assert.deepStrictEqual(
      plan.map(({ targetPath, replaces }) => [targetPath, replaces]),
      [
        ['a.ini', false],
        ['sub/b.ini', false],
      ],
    );
  });

  test('conflicts are found without regard to casing', () => {
    const conflicts = findConflicts(
      items('Data/Game.INI', 'new.ini'),
      content(['data/game.ini']),
    );

    assert.deepStrictEqual(conflicts, [{ path: 'Data/Game.INI' }]);
  });

  test('replace overwrites the file that is there', () => {
    const [planned] = planTransfer(
      items('a.ini'),
      content(['A.ini']),
      'replace',
    );

    assert.strictEqual(planned.targetPath, 'a.ini');
    assert.strictEqual(planned.replaces, true);
  });

  test('skip leaves the taken names out and keeps the rest', () => {
    const plan = planTransfer(
      items('a.ini', 'b.ini'),
      content(['a.ini']),
      'skip',
    );

    assert.deepStrictEqual(
      plan.map(({ targetPath }) => targetPath),
      ['b.ini'],
    );
  });

  test('keep both gives the newcomer a free name beside the existing file', () => {
    const plan = planTransfer(
      items('sub/a.ini'),
      content(['sub/a.ini', 'sub/a copy.ini']),
      'keepBoth',
    );

    assert.strictEqual(plan[0].targetPath, 'sub/a copy 2.ini');
    assert.strictEqual(plan[0].replaces, false);
  });

  test('two sources that flatten to one name never overwrite each other', () => {
    const plan = planTransfer(items('a.ini', 'a.ini'), content([]), 'replace');

    assert.deepStrictEqual(
      plan.map(({ targetPath }) => targetPath),
      ['a.ini', 'a copy.ini'],
    );
  });

  test('a file named like a directory of the target is renamed even when replacing', () => {
    const plan = planTransfer(
      items('data'),
      content(['data/a.ini'], ['data']),
      'replace',
    );

    assert.strictEqual(plan[0].targetPath, 'data copy');
    assert.strictEqual(plan[0].replaces, false);
  });

  test('a folder transfer merges into a folder of the same name', () => {
    const plan = planTransfer(
      items('art/a.tga', 'art/b.tga'),
      content(['art/a.tga'], ['art']),
      'keepBoth',
    );

    assert.deepStrictEqual(
      plan.map(({ targetPath }) => targetPath),
      ['art/a copy.tga', 'art/b.tga'],
    );
  });
});
