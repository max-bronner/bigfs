import * as assert from 'assert';
import { runLatest } from '../../core/runLatest';

/** A run that ends when the test lets it, counting how many started */
const gatedAction = () => {
  const gates: (() => void)[] = [];
  let started = 0;
  const action = () => {
    started++;
    return new Promise<void>((resolve) => gates.push(resolve));
  };

  return {
    action,
    started: () => started,
    release: async () => {
      gates.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

suite('runLatest', () => {
  test('a burst of calls costs one run in flight and one after it', async () => {
    const gated = gatedAction();
    const run = runLatest(gated.action);
    const calls = [run(), run(), run(), run()];

    assert.strictEqual(gated.started(), 1);
    await gated.release();
    assert.strictEqual(gated.started(), 2);
    await gated.release();
    await Promise.all(calls);
    assert.strictEqual(gated.started(), 2);
  });

  test('a call made after the runs ended starts a new one', async () => {
    const gated = gatedAction();
    const run = runLatest(gated.action);
    const first = run();

    await gated.release();
    await first;
    const second = run();

    assert.strictEqual(gated.started(), 2);
    await gated.release();
    await second;
  });

  test('a failed run does not stop the one waiting behind it', async () => {
    let started = 0;
    const run = runLatest(async () => {
      started++;
      await new Promise((resolve) => setImmediate(resolve));
      if (started === 1) {
        throw new Error('first fails');
      }
    });
    const first = run();
    const second = run();

    await assert.rejects(first, /first fails/);
    await second;
    assert.strictEqual(started, 2);
  });
});
