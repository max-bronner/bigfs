import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import {
  findClosestNames,
  formatSageIni,
  formatSageIniStable,
  findMissingEndLine,
} from '../../formats/ini/sageIniFormat';

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

    assert.strictEqual(findMissingEndLine(lines, 1), 3);
    assert.strictEqual(findMissingEndLine(lines, 4), 5);
  });

  test('suggestions are near misses only', () => {
    assert.deepStrictEqual(
      findClosestNames('AtackRange', ['AttackRange', 'AttackSpeed', 'Armor']),
      ['AttackRange'],
    );
    assert.deepStrictEqual(findClosestNames('Zzz', ['AttackRange']), []);
  });

  test('formatting twice gives what formatting once does', () => {
    const unit = '  ';
    const parse = (text: string[]) => parseSageIni(text, schema);
    const samples = [
      // Unknown keywords are nested by their indentation, which a pass rewrites
      [
        '  Side = X',
        '\t\tPrimaryDamage = 3',
        '  MaxHealth = 5',
        '; comment',
        '     BeginScript',
        '  End',
        'Bogus = 1',
        '\tEndScript',
      ],
      ['Weapon W', '\t\tUnknown', '  End', 'End', '   End'],
      [
        'Object O',
        '    Draw = Nothing T',
        'Mystery = 1',
        '  End',
        'End',
        'End',
      ],
    ];

    for (const lines of samples) {
      const once = formatSageIniStable(lines, parse, unit);

      assert.deepStrictEqual(formatSageIniStable(once, parse, unit), once);
    }
  });
});
