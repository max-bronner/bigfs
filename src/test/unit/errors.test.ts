import * as assert from 'assert';
import { describeError } from '../../core/errors';

suite('describeError', () => {
  test('uses the message of an Error', () => {
    assert.strictEqual(describeError(new RangeError('out of range')), 'out of range');
  });

  test('stringifies anything else', () => {
    assert.strictEqual(describeError('plain'), 'plain');
    assert.strictEqual(describeError(42), '42');
    assert.strictEqual(describeError(undefined), 'undefined');
    assert.strictEqual(describeError({ toString: () => 'custom' }), 'custom');
  });
});
