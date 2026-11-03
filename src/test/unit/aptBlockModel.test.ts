import * as assert from 'assert';
import {
  addChoices,
  bytesToFloats,
  cssColour,
  floatsToBytes,
  hexColour,
  summarizeItem,
  getItemTitle,
  matchesSearch,
  moveTarget,
  parseHexColour,
} from '../../webview/apt/blocks/blockModel';
import {
  findErrorSpan,
  offsetOf,
  positionOf,
  segmentScript,
  tokenizeScript,
} from '../../webview/apt/blocks/scriptHighlight';
import { checkScript } from '../../formats/apt/aptScript';

suite('APT block model', () => {
  test('each spot offers the record kinds that fit there', () => {
    assert.deepStrictEqual(
      addChoices('frame').map((choice) => choice.id),
      ['placement', 'frameLabel', 'background', 'script'],
    );
    assert.deepStrictEqual(
      addChoices('button').map((choice) => choice.id),
      ['buttonRecord', 'script'],
    );
    assert.deepStrictEqual(
      addChoices('text').map((choice) => choice.id),
      ['textRun'],
    );
    assert.ok(addChoices('movie').some((choice) => choice.id === 'export'));
  });

  test('frame items are named and summarised for their headers', () => {
    const placed = {
      offset: 16,
      type: 'placeObject' as const,
      flags: 0x80ff,
      depth: 4,
      character: 7,
      name: 'clip',
      translate: [5, 6] as [number, number],
    };

    assert.strictEqual(getItemTitle(placed), 'Place @4');
    assert.strictEqual(summarizeItem(placed), '#7 · "clip" · at 5, 6 · move');
    assert.strictEqual(
      summarizeItem({
        offset: 0,
        type: 'frameLabel',
        label: 'go',
        flags: 0,
        frame: 0,
      }),
      '"go"',
    );
    assert.strictEqual(
      summarizeItem({ offset: 0, type: 'backgroundColor', color: 0xff102030 }),
      '0xff102030',
    );
  });

  test('a move target is kept inside the list', () => {
    assert.strictEqual(moveTarget(4, 0, -1), 0);
    assert.strictEqual(moveTarget(4, 3, 9), 3);
  });

  test('float colours become bytes and back', () => {
    assert.deepStrictEqual(floatsToBytes([0, 0.5, 1, 2]), [0, 128, 255, 255]);
    assert.deepStrictEqual(bytesToFloats([0, 255, 51, 300]), [0, 1, 0.2, 1]);
    assert.strictEqual(cssColour(255, 0, 0, 128), 'rgba(255, 0, 0, 0.5)');
  });

  test('hex colours are read strictly', () => {
    assert.strictEqual(hexColour(255, 0, 16), '#ff0010');
    assert.deepStrictEqual(parseHexColour('#FF0010'), [255, 0, 16]);
    assert.strictEqual(parseHexColour('ff0010'), undefined);
    assert.strictEqual(parseHexColour('#fff'), undefined);
  });

  test('a picker search matches every word, in any order, ignoring case', () => {
    assert.ok(matchesSearch('#12 Sprite · Hero', 'hero sprite'));
    assert.ok(matchesSearch('#12 Sprite', ''));
    assert.ok(!matchesSearch('#12 Sprite', 'button'));
  });
});

suite('APT script highlighting', () => {
  const kinds = (text: string) =>
    tokenizeScript(text).map((token) => [
      token.kind,
      text.slice(token.start, token.end),
    ]);

  test('keywords, strings, numbers, registers and comments are told apart', () => {
    assert.deepStrictEqual(kinds('if (x == 0x10) { $r1 = "hi"; } // done'), [
      ['keyword', 'if'],
      ['operator', '=='],
      ['number', '0x10'],
      ['register', '$r1'],
      ['operator', '='],
      ['string', '"hi"'],
      ['comment', '// done'],
    ]);
  });

  test('labels, directives and quoted names have their own kinds', () => {
    assert.deepStrictEqual(kinds('loop:\n#Add(1, 2);\n`a b`.c'), [
      ['label', 'loop'],
      ['directive', '#Add'],
      ['number', '1'],
      ['number', '2'],
      ['name-quoted', '`a b`'],
    ]);
  });

  test("a conditional's colon is not a label, and an assignment form is an operator", () => {
    assert.ok(!kinds('x = a ? b : c').some(([kind]) => kind === 'label'));
    assert.deepStrictEqual(kinds('x := f()'), [['operator', ':=']]);
  });

  test('text that does not lex still comes back covered', () => {
    const text = 'x = "unclosed\n@@ y /* open';
    const joined = segmentScript(text)
      .map((segment) => segment.text)
      .join('');

    assert.strictEqual(joined, text);
  });

  test('segments cut at the error and mark only it', () => {
    const text = 'stop();\nfoo bar;';
    const span = findErrorSpan(text, 2, 5);
    const segments = segmentScript(text, span);

    assert.strictEqual(text.slice(span.start, span.end), 'bar');
    assert.deepStrictEqual(
      segments
        .filter((segment) => segment.error)
        .map((segment) => segment.text),
      ['bar'],
    );
    assert.strictEqual(segments.map((segment) => segment.text).join(''), text);
  });

  test('lines and columns convert to offsets and back', () => {
    const text = 'ab\ncde\n\nf';

    assert.strictEqual(offsetOf(text, 2, 2), 4);
    assert.deepStrictEqual(positionOf(text, 4), { line: 2, column: 2 });
    assert.strictEqual(offsetOf(text, 9, 1), text.length);
    assert.deepStrictEqual(positionOf(text, 0), { line: 1, column: 1 });
  });

  test("the compiler's error position lands on the offending token", () => {
    const text = 'stop();\nvar = ;';
    const problem = checkScript(text, []);

    assert.ok(problem?.line);

    const span = findErrorSpan(text, problem.line!, problem.column ?? 1);

    assert.ok(span.end > span.start);
    assert.ok(span.start >= text.indexOf('\n'));
    assert.strictEqual(checkScript('stop();', []), undefined);
  });
});
