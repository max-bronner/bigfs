import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import { findSageIniProblems } from '../../language/model/sageIniProblems';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

/** The problems of a document, as `line: message` for readable failures */
const problemsOf = (lines: string[], isFragment = false): string[] =>
  findSageIniProblems(parseSageIni(lines, schema, { isFragment }), schema).map(
    ({ line, message }) => `${line}: ${message}`,
  );

suite('SAGE INI problems', () => {
  test('a valid document has none', () => {
    assert.deepStrictEqual(
      problemsOf([
        'Object GondorFighter',
        '  KindOf = INFANTRY',
        '  Body = ActiveBody ModuleTag_02',
        '    MaxHealth = 300',
        '  End',
        'End',
      ]),
      [],
    );
  });

  test('a field the block does not read is reported where it is written', () => {
    assert.deepStrictEqual(
      problemsOf([
        'Object GondorFighter',
        '  Body = ActiveBody ModuleTag_02',
        '    MaxHelth = 300',
        '  End',
        'End',
      ]),
      [
        "2: 'MaxHelth' is not a block or field Rise of the Witch-king reads in ActiveBody",
      ],
    );
  });

  test('an unknown root block, an unclosed block and a stray End are reported', () => {
    assert.deepStrictEqual(
      problemsOf([
        'NotABlock Foo',
        'End',
        'End',
        'Object A',
        '  KindOf = INFANTRY',
      ]),
      [
        "0: 'NotABlock' is not a block or field Rise of the Witch-king reads at file scope",
        "3: 'Object' is never closed with End",
        '2: End with no block open to close',
      ],
    );
  });

  test('a fragment may end on the End of the block that includes it', () => {
    assert.deepStrictEqual(
      problemsOf(['  KindOf = INFANTRY', 'End'], true),
      [],
    );
  });

  test('an unknown module is reported once, and its lines are not checked', () => {
    assert.deepStrictEqual(
      problemsOf([
        'Object A',
        '  Behavior = SomeFutureModule ModuleTag_01',
        '    AnythingAtAll = 1',
        '  End',
        'End',
      ]),
      [
        "1: 'SomeFutureModule' is not a module Rise of the Witch-king registers",
      ],
    );
  });

  test('a malformed arithmetic call is an error', () => {
    assert.deepStrictEqual(
      problemsOf(['Object A', '  CommandPoints = #ADD( 5 )', 'End']),
      ['1: #ADD takes two operands, not 1'],
    );
  });

  test('in BFME mode unknown names pass, while structure is still checked', () => {
    const bfme1 = createSageIniSchema(
      JSON.parse(
        readFileSync(
          join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
          'utf8',
        ),
      ),
      'bfme1',
    );
    const problems = findSageIniProblems(
      parseSageIni(['Object A', '  OnlyInBfme = 1', 'End', 'End'], bfme1),
      bfme1,
    ).map(({ line, message }) => `${line}: ${message}`);

    assert.deepStrictEqual(problems, ['3: End with no block open to close']);
  });
});
