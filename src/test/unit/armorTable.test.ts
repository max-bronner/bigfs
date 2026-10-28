import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  armorEdit,
  armorValue,
  damageTypes,
  readArmorRows,
  shownArmor,
} from '../../language/model/armorTable';
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

  const rowsOf = (text: string) => {
    const lines = text.split('\n');

    return readArmorRows(parseSageIni(lines, schema), lines, 'file:///b.ini');
  };

  test('a type no line reaches lets everything through', () => {
    const [row] = rowsOf('Armor NoDefault\n  Armor = CRUSH 50%\nEnd\n');

    assert.deepStrictEqual(shownArmor(row, 'PIERCE'), {
      value: '100%',
      inherited: true,
    });
    assert.deepStrictEqual(shownArmor(row, 'DEFAULT'), {
      value: '100%',
      inherited: true,
    });
    assert.deepStrictEqual(shownArmor(row, 'CRUSH'), {
      value: '50%',
      inherited: false,
    });
  });

  test('DEFAULT overwrites the types written before it, not after', () => {
    const [row] = rowsOf(
      'Armor Ordered\n  Armor = CRUSH 50%\n  Armor = DEFAULT 80%\n  Armor = PIERCE 20%\nEnd\n',
    );

    assert.deepStrictEqual(shownArmor(row, 'CRUSH'), {
      value: '80%',
      inherited: true,
    });
    assert.deepStrictEqual(shownArmor(row, 'PIERCE'), {
      value: '20%',
      inherited: false,
    });
    assert.deepStrictEqual(shownArmor(row, 'FLAME'), {
      value: '80%',
      inherited: true,
    });
  });

  test('an edit lands where the game will read it', () => {
    const [row] = rowsOf(
      'Armor Ordered\n  Armor = CRUSH 50%\n  Armor = DEFAULT 80%\n  Armor = PIERCE 20%\nEnd\n',
    );

    assert.deepStrictEqual(armorEdit(row, 'PIERCE', '30%'), {
      kind: 'replace',
      line: 3,
      start: 17,
      end: 20,
      old: '20%',
    });
    // CRUSH's line is overwritten by the DEFAULT below it: write a new one last
    assert.deepStrictEqual(armorEdit(row, 'CRUSH', '10%', '\r\n'), {
      kind: 'insert',
      line: 4,
      text: '  Armor = CRUSH 10%\r\n',
    });

    const [bare] = rowsOf('Armor Bare\n  Armor = CRUSH 50%\nEnd\n');

    // A new DEFAULT goes first, or it would wipe CRUSH
    assert.deepStrictEqual(armorEdit(bare, 'DEFAULT', '70%'), {
      kind: 'insert',
      line: 1,
      text: '  Armor = DEFAULT 70%\n',
    });
  });
});
