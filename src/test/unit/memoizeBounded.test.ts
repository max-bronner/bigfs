import * as assert from 'assert';
import { memoizeBounded } from '../../core/memoizeBounded';

suite('memoizeBounded', () => {
  test('computes an argument once however often it is asked', () => {
    let calls = 0;
    const lower = memoizeBounded((text) => {
      calls += 1;

      return text.toLowerCase();
    }, 10);

    assert.strictEqual(lower('AbC'), 'abc');
    assert.strictEqual(lower('AbC'), 'abc');
    assert.strictEqual(calls, 1);
  });

  test('starts over at the limit, so unseen arguments cannot grow it without bound', () => {
    let calls = 0;
    const identity = memoizeBounded((text) => {
      calls += 1;

      return text;
    }, 2);

    identity('a');
    identity('b');
    identity('c');
    identity('a');

    assert.strictEqual(calls, 4);
  });
});
