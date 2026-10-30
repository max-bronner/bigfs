import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BulkQueryError,
  planBulkChanges,
  planBulkChangesAcross,
  compileBulkQuery,
} from '../../game/ini-tools/bulkEdit';
import type { BulkQuery, BulkSource } from '../../game/ini-tools/bulkEdit';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

const TEXT = `Object TestArcher
  Side = Testland
  KindOf = PRELOAD SELECTABLE INFANTRY
  BuildCost = 120
  Body = ActiveBody ModuleTag_Body
    MaxHealth = 200
  End
End

Object TestKnight
  Side = Testland
  KindOf = SELECTABLE CAVALRY
  BuildCost = 300
  Body = ActiveBody ModuleTag_Body
    MaxHealth = 600
  End
End

Object OtherArcher
  Side = Elsewhere
  KindOf = INFANTRY
  BuildCost = 100
  BuildTime = 15.5
End
`;

const run = (query: Partial<BulkQuery>) =>
  planBulkChanges(
    parseSageIni(TEXT.split('\n'), schema),
    compileBulkQuery({
      blocks: 'Object',
      where: '',
      field: 'BuildCost',
      formula: 'x',
      ...query,
    }),
  );

const describeChanges = (query: Partial<BulkQuery>) =>
  run(query).changes.map(
    (change) => `${change.block}: ${change.before} -> ${change.after}`,
  );

suite('INI bulk edits', () => {
  test('a module field changes only in the blocks the conditions pick', () => {
    assert.deepStrictEqual(
      describeChanges({
        where: 'Side = Testland; KindOf ~ INFANTRY',
        field: 'ActiveBody/MaxHealth',
        formula: 'x * 1.1',
      }),
      ['Object TestArcher: 200 -> 220'],
    );
  });

  test("names, numeric conditions and the block's own fields", () => {
    assert.deepStrictEqual(
      describeChanges({
        blocks: 'Object *Archer',
        where: 'BuildCost >= 110',
        formula: 'x + BuildCost / 10',
      }),
      ['Object TestArcher: 120 -> 132'],
    );
    // A decimal stays decimal; a whole number is rounded
    assert.deepStrictEqual(describeChanges({ field: 'BuildTime', formula: 'x / 3' }), [
      'Object OtherArcher: 15.5 -> 5.1667',
    ]);
    assert.deepStrictEqual(describeChanges({ formula: 'x / 7' }), [
      'Object TestArcher: 120 -> 17',
      'Object TestKnight: 300 -> 43',
      'Object OtherArcher: 100 -> 14',
    ]);
  });

  test('names that are not numbers are counted, not changed', () => {
    const result = run({ field: 'Side', formula: 'x + 1' });

    assert.deepStrictEqual(
      [result.changes.length, result.blocks, result.skipped],
      [0, 3, 3],
    );
  });

  test('a malformed input says which part is wrong', () => {
    assert.throws(() => run({ where: 'Side Testland' }), BulkQueryError);
    assert.throws(() => run({ field: 'Body/' }), BulkQueryError);
    assert.throws(() => run({ formula: 'x *' }), BulkQueryError);
  });

  suite('where a value is defined', () => {
    const source = (uri: string, text: string, isFragment = false) => ({
      uri,
      document: parseSageIni(text.split('\n'), schema, { isFragment }),
    });
    const across = (
      files: BulkSource[],
      fragments: BulkSource[],
      query: Partial<BulkQuery>,
    ) =>
      planBulkChangesAcross(
        {
          sources: files,
          include: (_from, path) =>
            fragments.find((each) => each.uri === path.toLowerCase()),
        },
        compileBulkQuery({
          blocks: 'Object',
          where: '',
          field: 'BuildCost',
          formula: 'x * 2',
          ...query,
        }),
      );

    test('a macro value is edited in the #define, once', () => {
      const file = source(
        'a.ini',
        '#define COST 100\nObject A\n  BuildCost = COST\nEnd\nObject B\n  BuildCost = COST\nEnd\n',
      );
      const result = across([file], [], {});

      assert.deepStrictEqual(
        result.changes.map((c) => [c.uri, c.line, c.before, c.after, c.via]),
        [['a.ini', 0, '100', '200', 'macro COST']],
      );
      assert.strictEqual(result.redirected, 1);
    });

    test('a macro whose body is not one number is reported, not edited', () => {
      const file = source(
        'a.ini',
        '#define COST 100 200\nObject A\n  BuildCost = COST\nEnd\n',
      );
      const result = across([file], [], {});

      assert.deepStrictEqual(result.changes, []);
      assert.strictEqual(result.unresolved.length, 1);
    });

    test('fields from an included fragment are edited in that file', () => {
      const fragment = source('parts.inc', '  BuildCost = 50\n', true);
      const file = source('a.ini', 'Object A\n  #include "parts.inc"\nEnd\n');
      const result = across([file], [fragment], {});

      assert.deepStrictEqual(
        result.changes.map((c) => [c.uri, c.before, c.after, c.via]),
        [['parts.inc', '50', '100', 'included file']],
      );
    });

    test('a ChildObject that writes no value edits its parent where it is defined', () => {
      const file = source(
        'a.ini',
        'Object Base\n  BuildCost = 70\nEnd\nChildObject Kid Base\n  Side = X\nEnd\n',
      );
      const result = across([file], [], { blocks: 'ChildObject' });

      assert.deepStrictEqual(
        result.changes.map((c) => [c.line, c.before, c.after, c.via]),
        [[1, '70', '140', 'inherited from Kid'.replace('Kid', 'Base')]],
      );
      // A child that overrides is edited itself
      const own = source(
        'b.ini',
        'Object Base\n  BuildCost = 70\nEnd\nChildObject Kid Base\n  BuildCost = 10\nEnd\n',
      );

      assert.deepStrictEqual(
        across([own], [], { blocks: 'ChildObject' }).changes.map((c) => c.line),
        [4],
      );
    });

    test('conditions see inherited and macro values', () => {
      const file = source(
        'a.ini',
        '#define SIDE Rohan\nObject Base\n  Side = SIDE\nEnd\nChildObject Kid Base\n  BuildCost = 5\nEnd\n',
      );

      assert.strictEqual(
        across([file], [], {
          blocks: 'ChildObject',
          where: 'Side = Rohan',
        }).changes.length,
        1,
      );
    });

    test('a computed value is reported as not editable', () => {
      const file = source(
        'a.ini',
        'Object A\n  BuildCost = #ADD( 10 20 )\nEnd\n',
      );
      const result = across([file], [], {});

      assert.deepStrictEqual(result.changes, []);
      assert.strictEqual(result.unresolved.length + result.skipped, 1);
    });
  });
});
