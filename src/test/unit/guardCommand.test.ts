import * as assert from 'assert';
import { describeError } from '../../core/errors';
import { guardCommand } from '../../platform/guardCommand';

/** A sink that records what the user was shown and what was logged */
const fakeSink = () => {
  const shown: string[] = [];
  const logged: [string, unknown][] = [];

  return {
    shown,
    logged,
    sink: () => ({
      showError: (message: string) => shown.push(message),
      logError: (id: string, error: unknown) => logged.push([id, error]),
    }),
  };
};

suite('Command error wrapping', () => {
  test('passes arguments and the result through', async () => {
    const { sink, shown } = fakeSink();
    const run = guardCommand(
      'bigfs.x',
      async (a: number, b: number) => a + b,
      sink,
      describeError,
    );

    assert.strictEqual(await run(1, 2), 3);
    assert.deepStrictEqual(shown, []);
  });

  test('reports a thrown error once, with its message, and logs it', () => {
    const { sink, shown, logged } = fakeSink();
    const failure = new Error('disk full');
    const run = guardCommand(
      'bigfs.x',
      () => {
        throw failure;
      },
      sink,
      describeError,
    );

    assert.strictEqual(run(), undefined);
    assert.deepStrictEqual(shown, ['disk full']);
    assert.deepStrictEqual(logged, [['bigfs.x', failure]]);
  });

  test('reports a rejected promise once and resolves to undefined', async () => {
    const { sink, shown } = fakeSink();
    const run = guardCommand(
      'bigfs.x',
      async () => Promise.reject('plain string'),
      sink,
      describeError,
    );

    assert.strictEqual(await run(), undefined);
    assert.deepStrictEqual(shown, ['plain string']);
  });

  test('reports without a log when the sink has none', () => {
    const shown: string[] = [];
    const run = guardCommand(
      'bigfs.x',
      () => {
        throw new Error('nope');
      },
      () => ({ showError: (message) => shown.push(message) }),
      describeError,
    );

    run();
    assert.deepStrictEqual(shown, ['nope']);
  });
});
