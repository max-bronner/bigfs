import * as assert from 'assert';
import {
  evaluateCall,
  evaluateMacroBody,
  scanCalls,
} from '../../formats/ini/sageIniPreprocessor';

const macros: Record<string, string> = {
  hero_health: '1500',
  bonus: '25%',
  derived: '#MULTIPLY( HERO_HEALTH 2 )',
  loop: '#ADD( LOOP 1 )',
  filter: 'NONE +INFANTRY',
};
const lookup = (name: string) => macros[name.toLowerCase()];

/** The value of the one call in a line */
const evaluate = (line: string) => evaluateCall(scanCalls(line, 0)[0], lookup);

suite('SAGE INI preprocessor', () => {
  test('evaluates all four operations, through macros', () => {
    assert.deepStrictEqual(evaluate('#ADD( HERO_HEALTH 100 )'), {
      value: 1600,
    });
    assert.deepStrictEqual(evaluate('#SUBTRACT( 10 4 )'), { value: 6 });
    assert.deepStrictEqual(evaluate('#MULTIPLY( HERO_HEALTH 1.5 )'), {
      value: 2250,
    });
    assert.deepStrictEqual(evaluate('#DIVIDE( 9, 3 )'), { value: 3 });
  });

  test('a macro whose body is a call is evaluated, and a cycle is caught', () => {
    assert.deepStrictEqual(evaluate('#ADD( DERIVED 0 )'), { value: 3000 });
    assert.deepStrictEqual(evaluateMacroBody(macros.derived, lookup), {
      value: 3000,
    });
    assert.match(
      (evaluate('#ADD( LOOP 0 )') as { error: string }).error,
      /refers to itself/,
    );
  });

  test('malformed calls carry an error from the scan alone', () => {
    const errors = [
      '#ADD( 1 )',
      '#ADD( 1 2',
      '#POWER( 2 3 )',
      '#DIVIDE( 5 0 )',
    ].map((line) => scanCalls(line, 0)[0].error);

    assert.deepStrictEqual(errors, [
      '#ADD takes two operands, not 1',
      "#ADD is missing its closing ')'",
      "'#POWER' is not an arithmetic call; the engine has #ADD, #SUBTRACT, #MULTIPLY and #DIVIDE",
      '#DIVIDE by zero',
    ]);
  });

  test('an operand that is not a number or a known macro is named', () => {
    assert.match(
      (evaluate('#ADD( FILTER 1 )') as { error: string }).error,
      /stands for 'NONE \+INFANTRY'/,
    );
    assert.match(
      (evaluate('#ADD( MISSING 1 )') as { error: string }).error,
      /'MISSING' is neither/,
    );
  });
});
