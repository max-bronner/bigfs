import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BulkQueryError,
  bulkChanges,
  compileBulkQuery,
} from '../../language/model/bulkEdit';
import type { BulkQuery } from '../../language/model/bulkEdit';
import { parseSageIni } from '../../language/model/sageIniParser';
import { createSageIniSchema } from '../../language/model/sageIniSchema';

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
  bulkChanges(
    parseSageIni(TEXT.split('\n'), schema),
    compileBulkQuery({
      blocks: 'Object',
      where: '',
      field: 'BuildCost',
      formula: 'x',
      ...query,
    }),
  );

const afters = (query: Partial<BulkQuery>) =>
  run(query).changes.map(
    (change) => `${change.block}: ${change.before} -> ${change.after}`,
  );

suite('INI bulk edits', () => {
  test('a module field changes only in the blocks the conditions pick', () => {
    assert.deepStrictEqual(
      afters({
        where: 'Side = Testland; KindOf ~ INFANTRY',
        field: 'ActiveBody/MaxHealth',
        formula: 'x * 1.1',
      }),
      ['Object TestArcher: 200 -> 220'],
    );
  });

  test("names, numeric conditions and the block's own fields", () => {
    assert.deepStrictEqual(
      afters({
        blocks: 'Object *Archer',
        where: 'BuildCost >= 110',
        formula: 'x + BuildCost / 10',
      }),
      ['Object TestArcher: 120 -> 132'],
    );
    // A decimal stays decimal; a whole number is rounded
    assert.deepStrictEqual(afters({ field: 'BuildTime', formula: 'x / 3' }), [
      'Object OtherArcher: 15.5 -> 5.1667',
    ]);
    assert.deepStrictEqual(afters({ formula: 'x / 7' }), [
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
});
