import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  armorValue,
  damageTypes,
  readArmorRows,
} from '../../language/model/armorTable';
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

const TEXT = `Armor TestArmor
  Armor = DEFAULT 100%
  Armor = CRUSH 50% ; heavy
End

Armor TestOther
    Armor = PIERCE 20%
End
`;

suite('Armor table', () => {
  test('rows, damage types and values as the INI writes them', () => {
    const lines = TEXT.split('\n');
    const rows = readArmorRows(
      parseSageIni(lines, schema),
      lines,
      'file:///a.ini',
    );

    assert.deepStrictEqual(
      rows.map((row) => [row.name, Object.keys(row.cells), row.indent]),
      [
        ['TestArmor', ['DEFAULT', 'CRUSH'], '  '],
        ['TestOther', ['PIERCE'], '    '],
      ],
    );
    assert.deepStrictEqual(rows[0].cells.CRUSH, {
      value: '50%',
      line: 2,
      start: 16,
      end: 19,
    });
    assert.deepStrictEqual(damageTypes(rows), ['DEFAULT', 'CRUSH', 'PIERCE']);
    assert.deepStrictEqual(['75', ' 12.5 % ', 'x'].map(armorValue), [
      '75%',
      '12.5%',
      undefined,
    ]);
  });
});
