import * as assert from 'assert';
import { SCRIPT_PRIORITY, createScriptQueue } from '../../webview/apt/scriptQueue';

suite('APT script queue', () => {
  const start = (isBlocked = () => false) => {
    const ran: string[] = [];
    const overflows: number[] = [];

    return {
      ran,
      overflows,
      record: (name: string) => () => void ran.push(name),
      queue: createScriptQueue(isBlocked, (limit) => overflows.push(limit)),
    };
  };

  test('a lower priority empties first, in order within each', () => {
    const { queue, ran, record } = start();

    queue.add(record('frame'));
    queue.add(record('construct'), SCRIPT_PRIORITY.construct);
    queue.add(record('frame 2'));
    queue.add(record('init'), SCRIPT_PRIORITY.initialize);
    queue.drain();
    assert.deepStrictEqual(ran, ['init', 'construct', 'frame', 'frame 2']);
  });

  test('a script added by a script runs after it, not inside it', () => {
    const { queue, ran, record } = start();

    queue.add(() => {
      queue.add(record('second'));
      queue.drain();
      ran.push('first');
    });
    queue.drain();
    assert.deepStrictEqual(ran, ['first', 'second']);
  });

  test('hold keeps what is added until the caller drains', () => {
    const { queue, ran, record } = start();

    const result = queue.hold(() => {
      queue.add(record('held'));
      queue.drain();
      return 'done';
    });

    assert.strictEqual(result, 'done');
    assert.deepStrictEqual(ran, []);
    queue.drain();
    assert.deepStrictEqual(ran, ['held']);
  });

  test('nothing runs while blocked', () => {
    let isBlocked = true;
    const { queue, ran, record } = start(() => isBlocked);

    queue.add(record('waits'));
    queue.drain();
    assert.deepStrictEqual(ran, []);
    isBlocked = false;
    queue.drain();
    assert.deepStrictEqual(ran, ['waits']);
  });

  test('scripts that keep starting each other stop at the limit', () => {
    const { queue, overflows } = start();
    const again = () => queue.add(again);

    queue.add(again);
    queue.drain();
    assert.deepStrictEqual(overflows, [1000]);
  });
});
