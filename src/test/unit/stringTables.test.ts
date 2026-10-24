import * as assert from 'assert';
import { parseCsf, writeCsf } from '../../formats/csf';
import {
  parseStringRecords,
  quoteStringText,
} from '../../language/model/sageStringRecords';

const SOURCE = [
  '// units',
  'OBJECT:Soldier',
  '"Gondor  Soldiers"',
  'END',
  '',
  '  CONTROLBAR:Long',
  '"first line',
  '   second \\"part\\"" trailing',
  'END',
  'NOTEXT:Label',
  'END',
  'OBJECT:Soldier',
  '"Second"',
  'END',
].join('\r\n');

suite('String tables', () => {
  test('records carry the spans of their label and quoted text', () => {
    const records = parseStringRecords(SOURCE);

    assert.deepStrictEqual(
      records.map((record) => [record.label, record.text, record.line]),
      [
        ['OBJECT:Soldier', 'Gondor Soldiers', 1],
        ['CONTROLBAR:Long', 'first line second "part"', 5],
        ['NOTEXT:Label', undefined, 9],
        ['OBJECT:Soldier', 'Second', 11],
      ],
    );

    const long = records[1];

    assert.strictEqual(
      SOURCE.slice(long.labelSpan.start, long.labelSpan.end),
      'CONTROLBAR:Long',
    );
    assert.strictEqual(
      SOURCE.slice(long.textSpan?.start, long.textSpan?.end),
      '"first line\r\n   second \\"part\\""',
    );
    assert.ok(SOURCE.slice(long.span.start, long.span.end).endsWith('END\r\n'));
  });

  test('quoting a text reads back as the same text', () => {
    const text = 'Say "hi"\nthen\ttab \\ done';
    const [record] = parseStringRecords(`L\n${quoteStringText(text)}\nEND\n`);

    assert.strictEqual(record.text, text);
  });

  test('a .csf reads and writes back byte for byte', () => {
    const file = {
      version: 3,
      reserved: 7,
      language: 0,
      labels: [
        { name: 'GUI:Ok', strings: [{ text: 'OK' }] },
        {
          name: 'DLG:Line',
          strings: [
            { text: 'Ünïcødé ✓', speech: 'line01' },
            { text: 'second' },
          ],
        },
        { name: 'EMPTY', strings: [] },
      ],
    };
    const bytes = writeCsf(file);

    assert.deepStrictEqual(parseCsf(bytes), file);
    assert.deepStrictEqual(writeCsf(parseCsf(bytes)), bytes);
    assert.throws(
      () => parseCsf(bytes.subarray(0, bytes.length - 3)),
      /past the end/,
    );
  });
});
