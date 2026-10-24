import * as assert from 'assert';
import { findScriptProblems } from '../../language/model/sageIniScripts';

suite('INI embedded scripts', () => {
  test('a syntax error is placed on its file line', () => {
    const lines = [
      'Object A',
      '  BeginScript',
      '    function OnCreated(self)',
      '      x = = 1',
      '    end',
      '  EndScript',
      'End',
    ];

    assert.deepStrictEqual(
      findScriptProblems(lines, [{ startLine: 1, endLine: 5 }]).map(
        (problem) => problem.line,
      ),
      [3],
    );
    assert.deepStrictEqual(
      findScriptProblems(
        ['BeginScript', 'local a = 1', 'EndScript'],
        [{ startLine: 0, endLine: 2 }],
      ),
      [],
    );
  });
});
