import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import {
  closestNames,
  formatSageIni,
  missingEndLine,
} from '../../language/model/sageIniFormat';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

suite('SAGE INI formatting and fixes', () => {
  test('indentation follows the blocks, scripts and text stay as written', () => {
    const lines = [
      'Weapon Bow   ',
      'AttackRange = 200 ; long',
      '      DamageNugget',
      ' Damage = 10',
      '   End',
      '',
      'End',
    ];

    assert.deepStrictEqual(
      formatSageIni(lines, parseSageIni(lines, schema), '  '),
      [
        'Weapon Bow',
        '  AttackRange = 200 ; long',
        '  DamageNugget',
        '    Damage = 10',
        '  End',
        '',
        'End',
      ],
    );
  });

  test('a missing End goes after the deeper-indented lines', () => {
    const lines = [
      'Object A',
      '  Body = ActiveBody M',
      '    MaxHealth = 1',
      '  ; note',
      'Object B',
      'End',
    ];

    assert.strictEqual(missingEndLine(lines, 1), 3);
    assert.strictEqual(missingEndLine(lines, 4), 5);
  });

  test('suggestions are near misses only', () => {
    assert.deepStrictEqual(
      closestNames('AtackRange', ['AttackRange', 'AttackSpeed', 'Armor']),
      ['AttackRange'],
    );
    assert.deepStrictEqual(closestNames('Zzz', ['AttackRange']), []);
  });
});
