import * as assert from 'assert';
import { parseConst } from '../../formats/apt/aptMovie';
import { createScriptReader, printMovieFiles } from '../../formats/apt/text/movieText';
import { alignLists } from '../../formats/apt/text/save/alignLists';
import { saveMovieText } from '../../formats/apt/text/save/saveMovieText';
import { movieToText } from '../../formats/apt/text/fromMovie';
import { parseMovieText } from '../../formats/apt/text/parser';
import { buildLargeMovie } from './aptLarge';

/** Generous: the work takes a fraction of this, a quadratic walk takes many times it */
const BOUND_MS = 3000;

const timed = <T>(run: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = run();

  return { value, ms: performance.now() - start };
};

suite('APT text of a large movie', () => {
  const { apt, constFile } = buildLargeMovie(100, 13);
  const printed = timed(() => printMovieFiles(apt, constFile));
  const before = movieToText(
    apt,
    constFile,
    createScriptReader(apt, parseConst(constFile).items),
  );

  test('the synthetic movie is as long as a large interface movie', () => {
    assert.ok(printed.value.split('\n').length > 9000);
  });

  test('printing it stays well under a second or two', () => {
    assert.ok(printed.ms < BOUND_MS, `printing took ${printed.ms} ms`);
  });

  test('saving unchanged text gives no edits and the same bytes, quickly', () => {
    const parsed = parseMovieText(printed.value);

    assert.deepStrictEqual(parsed.problems, []);

    const { value: save, ms } = timed(() =>
      saveMovieText(apt, constFile, before, parsed.movie),
    );

    assert.deepStrictEqual(save.edits, []);
    assert.strictEqual(save.apt, apt);
    assert.ok(ms < BOUND_MS, `saving took ${ms} ms`);
  });

  test('saving one changed field gives one edit, quickly', () => {
    const edited = printed.value.replace('"clip_57_3"', '"renamed"');
    const parsed = parseMovieText(edited);

    assert.notStrictEqual(edited, printed.value);
    assert.deepStrictEqual(parsed.problems, []);

    const { value: save, ms } = timed(() =>
      saveMovieText(apt, constFile, before, parsed.movie),
    );

    assert.strictEqual(save.edits.length, 1);
    assert.ok(ms < BOUND_MS, `saving took ${ms} ms`);
  });

  test('a list that did not change pairs entry for entry', () => {
    const list = Array.from({ length: 20000 }, (_, index) => String(index));
    const { value: pairs, ms } = timed(() =>
      alignLists(list, list, (entry) => entry),
    );

    assert.deepStrictEqual(
      pairs,
      list.map((_, index) => [index, index]),
    );
    assert.ok(ms < BOUND_MS, `aligning took ${ms} ms`);
  });
});
