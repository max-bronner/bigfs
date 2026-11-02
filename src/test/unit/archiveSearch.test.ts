import * as assert from 'assert';
import { buildSearchPattern } from '../../core/buildSearchPattern';
import { collectLineMatches } from '../../core/collectLineMatches';
import { compilePathFilter } from '../../core/compilePathFilter';
import { looksBinary } from '../../core/looksBinary';
import { createMatchScanner } from '../../node/createMatchScanner';

suite('Archive text search', () => {
  test('a literal query is escaped and honours whole word and casing', () => {
    const pattern = buildSearchPattern({
      text: 'a.b',
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    });

    assert.ok('source' in pattern);
    assert.strictEqual(pattern.flags, 'gim');
    assert.ok(new RegExp(pattern.source, pattern.flags).test('x A.B y'));
    assert.ok(!new RegExp(pattern.source, pattern.flags).test('xa.by'));
    assert.ok(!new RegExp(pattern.source, pattern.flags).test('x aXb y'));
  });

  test('a broken regular expression is reported, not thrown', () => {
    const pattern = buildSearchPattern({
      text: '(unclosed',
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });

    assert.ok('error' in pattern);
    assert.ok(pattern.error.length > 0);
  });

  test('the path filter reads include and exclude boxes like VS Code', () => {
    const accepts = compilePathFilter('*.ini, data/lang', 'data/ini/skip/**');

    assert.ok(accepts('data/ini/object.ini', 'ini.big'));
    assert.ok(accepts('Data/Lang/english/x.txt', 'lang.big'));
    assert.ok(!accepts('data/ini/skip/a.ini', 'ini.big'));
    assert.ok(!accepts('art/readme.txt', 'art.big'));
    assert.ok(compilePathFilter('', '')('anything/at/all.txt', 'a.big'));
    assert.ok(compilePathFilter('ini.big/data', '')('data/a.ini', 'INI.big'));
    assert.ok(compilePathFilter('*.{ini,inc}', '')('data/a.inc', 'a.big'));
  });

  test('text is told from binary by a zero byte near the start', () => {
    assert.ok(!looksBinary(Uint8Array.from([0x41, 0x42, 0x0d, 0x0a])));
    assert.ok(looksBinary(Uint8Array.from([0x41, 0, 0x42])));
  });

  test('matches become lines with context, merged where they touch', () => {
    const text = [
      'a',
      'b',
      'needle',
      'c',
      'needle two needle',
      'd',
      'e',
      'f',
      'g',
      'needle',
    ].join('\r\n');
    const scanner = createMatchScanner('needle', 'g', 1000);
    const { matches } = scanner(text, 100);
    const { blocks, matchCount } = collectLineMatches(text, matches, 1);

    assert.strictEqual(matchCount, 4);
    assert.strictEqual(blocks.length, 2);
    assert.deepStrictEqual(
      blocks[0].lines.map((line) => line.line),
      [1, 2, 3, 4, 5],
    );
    assert.deepStrictEqual(blocks[0].lines[4].ranges, undefined);
    assert.deepStrictEqual(blocks[0].lines[3].ranges, [
      [0, 6],
      [11, 17],
    ]);
    assert.deepStrictEqual(blocks[0].lines[3].selection, [0, 6]);
    assert.strictEqual(blocks[0].lines[2].text, 'c');
    assert.deepStrictEqual(
      blocks[1].lines.map((line) => line.line),
      [8, 9],
    );
  });

  test('a long line is cut around its match and keeps the highlight', () => {
    const text = `${'x'.repeat(500)}needle${'y'.repeat(500)}`;
    const { matches } = createMatchScanner('needle', 'g', 1000)(text, 10);
    const [line] = collectLineMatches(text, matches, 0).blocks[0].lines;
    const [start, end] = line.ranges![0];

    assert.ok(line.text.length < 300);
    assert.strictEqual(line.text.slice(start, end), 'needle');
    assert.deepStrictEqual(line.selection, [500, 506]);
  });

  test('a pattern that backtracks without end is stopped and reported', () => {
    const scanner = createMatchScanner('(a+)+$', 'g', 100);
    const started = Date.now();
    const result = scanner(`${'a'.repeat(60)}b`, 10);

    assert.ok(result.timedOut);
    assert.ok(Date.now() - started < 3000);
    assert.deepStrictEqual(scanner('aaa', 10).matches, [0, 3]);
  });

  test('a scan stops at the match limit and skips empty matches', () => {
    const scanner = createMatchScanner('x*', 'g', 1000);

    assert.deepStrictEqual(scanner('axxbx', 10).matches, [1, 2, 4, 1]);
    assert.strictEqual(
      createMatchScanner('a', 'g', 1000)('aaaa', 2).matches.length,
      4,
    );
  });
});
