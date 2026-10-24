import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import {
  appendConstItems,
  decompileBlock,
  replaceBlock,
} from '../../formats/apt/aptScript';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/aptWriter';
import { buildMovie } from './apt.test';

/** Compiles a script into a fresh image and reads it back as text */
const roundTrip = (source: string) => {
  const image = new AptImage(new Uint8Array(0));
  const constants = [{ kind: 'number' as const, value: 1 }];
  const start = compileScript(parseScript(source), image, constants);

  return decompileBlock(image.bytes, start, constants);
};

const lines = (...text: string[]) => `${text.join('\n')}\n`;

suite('APT scripts', () => {
  test('a script compiles and decompiles back to the same text', () => {
    const source = lines(
      'constants "this", "_root", "gotoAndPlay", "visible", "counter";',
      'var i = 0;',
      'while (i < 10) {',
      '  _root.counter++;',
      '  i++;',
      '}',
      'if (this.visible) {',
      '  this.gotoAndPlay("show");',
      '} else {',
      '  $r1 = _root;',
      '}',
      'screen := _root.getScreen(1, "a");',
      'function OnClick($r1 a, b) flags 0x6a0002 {',
      '  return a + b * (2 - c);',
      '}',
      'x = [1, 2.5, -3, 0x10000];',
      'o = {"k": true, "n": null};',
      'f = function (v) {',
      '  return !v;',
      '};',
      '`odd.name` = this[key];',
      '#Trace("hi\\n");',
      '#Stop();',
    );
    const result = roundTrip(source);

    assert.strictEqual(result.note, undefined);
    assert.strictEqual(result.mode, 'script');
    assert.strictEqual(result.text, source);
  });

  test('values left on the stack across statements read as push and pop', () => {
    const source = lines(
      'push($r1);',
      'push($r2);',
      'refresh();',
      '$r2 = pop();',
      '$r1 = pop();',
      'push(1);',
      'asm Dup;',
      'pop();',
      'pop();',
    );

    assert.strictEqual(roundTrip(source).text, source);
  });

  test('gotos and labels that are not a plain if or while stay as written', () => {
    const source = lines(
      'L1:',
      'tick();',
      'if (busy) goto L1;',
      'unless (done) goto L2;',
      'goto L1;',
      'L2:',
    );
    const result = roundTrip(source);

    assert.strictEqual(result.mode, 'script');
    assert.strictEqual(result.text, source);
  });

  test('a shipped-style block reads as a script', () => {
    const { apt, constFile, block } = buildMovie();
    const result = decompileBlock(apt, block, parseConst(constFile).items);

    assert.strictEqual(result.mode, 'script');
    assert.match(result.text, /^constants "this", "stop";\n/);
    assert.match(result.text, /goto L1;\n#Stop\(\);\nL1:\n/);
  });

  test('replacing a block repoints the frame and adds what the .const lacks', () => {
    const { apt, constFile, block } = buildMovie();
    const parsed = parseConst(constFile);
    const image = new AptImage(apt);
    const { added } = replaceBlock(
      image,
      parsed.movieOffset,
      block,
      'push($r9);\n#Stop();\n',
      parsed.items,
    );

    assert.deepStrictEqual(added, [{ kind: 'number', value: 9 }]);

    const movie = parseAptMovie(image.bytes, parsed.movieOffset);
    const action = movie.frames[0].items.find((item) => item.type === 'action');

    assert.ok(action?.type === 'action' && action.block !== block);
    assert.deepStrictEqual(
      decodeBlock(image.bytes, action.block).map(
        (instruction) => instruction.name,
      ),
      ['PushData', 'Stop', 'End'],
    );

    const constBytes = appendConstItems(constFile, added);

    assert.deepStrictEqual(
      parseConst(constBytes).items.map((item) => item.value),
      ['this', 'stop', 7, 9],
    );
    // Bytes before the moved item array are untouched
    assert.deepStrictEqual(
      constBytes.subarray(0x20, constFile.length),
      constFile.subarray(0x20),
    );
  });

  test('errors name the line and what is wrong', () => {
    assert.throws(() => parseScript('x = ;'), /1:5/);
    assert.throws(
      () =>
        compileScript(
          parseScript('goto Nowhere;'),
          new AptImage(new Uint8Array(0)),
          [],
        ),
      /Nowhere/,
    );
    assert.throws(
      () =>
        compileScript(
          parseScript('#Pop();'),
          new AptImage(new Uint8Array(0)),
          [],
        ),
      /takes 1/,
    );
  });
});
