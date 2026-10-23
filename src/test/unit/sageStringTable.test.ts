import * as assert from 'assert';
import {
  findString,
  parseStringTable,
} from '../../language/model/sageStringTable';

suite('SAGE string tables', () => {
  test('reads a record past its comment lines, and skips comments between records', () => {
    const strings = parseStringTable(
      [
        '// header',
        'APT:SoloPlay',
        '// context: main menu',
        '"SOLO PLAY"',
        'END',
        '',
        'OBJECT:GondorFighter',
        '"Gondor Soldiers"',
        'end',
      ].join('\r\n'),
    );

    assert.deepStrictEqual(
      [...strings.values()].map(({ label, text, line }) => [label, text, line]),
      [
        ['APT:SoloPlay', 'SOLO PLAY', 1],
        ['OBJECT:GondorFighter', 'Gondor Soldiers', 6],
      ],
    );
  });

  test('a quote runs past its line, and the first closing quote ends it', () => {
    const strings = parseStringTable(
      ['A:Long', '"first line', '   second  line" "stray', 'END'].join('\n'),
    );

    assert.strictEqual(strings.get('a:long')?.text, 'first line second line');
  });

  test('escapes and spacing follow the engine', () => {
    const strings = parseStringTable(
      ['A:Escapes', '"one\\ntwo  \\"quoted\\" http:\\/\\/x "', 'END'].join(
        '\n',
      ),
    );

    assert.strictEqual(
      strings.get('a:escapes')?.text,
      'one\ntwo "quoted" http://x',
    );
  });

  test('the first record of a label wins', () => {
    const strings = parseStringTable(
      ['A:Twice', '"first"', 'END', 'a:twice', '"second"', 'END'].join('\n'),
    );

    assert.strictEqual(strings.get('a:twice')?.text, 'first');
  });

  test('a $ key is looked up as an APT label first, without casing', () => {
    const strings = parseStringTable(
      ['APT:SoloPlay', '"SOLO PLAY"', 'END'].join('\n'),
    );

    assert.strictEqual(findString(strings, '$soloplay')?.text, 'SOLO PLAY');
    assert.strictEqual(findString(strings, 'apt:SOLOPLAY')?.text, 'SOLO PLAY');
    assert.strictEqual(findString(strings, 'OBJECT:Missing'), undefined);
  });
});
