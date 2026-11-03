import * as assert from 'assert';
import { orderDraws } from '../../webview/shared/orderDraws';

const draw = (id: string, blend: 'opaque' | 'alpha' | 'additive', sortLevel = 0) => ({
  id,
  blend,
  sortLevel,
});

suite('Draw order', () => {
  test('opaque draws come first, in the order given', () => {
    const ordered = orderDraws([
      draw('glow', 'additive', 1),
      draw('wall', 'opaque'),
      draw('roof', 'opaque'),
    ]);

    assert.deepStrictEqual(
      ordered.map(({ id }) => id),
      ['wall', 'roof', 'glow'],
    );
  });

  test('blended draws go by sort level, and equal levels keep the order given', () => {
    const ordered = orderDraws([
      draw('c', 'alpha', 3),
      draw('a1', 'additive', 1),
      draw('b', 'alpha', 2),
      draw('a2', 'alpha', 1),
    ]);

    assert.deepStrictEqual(
      ordered.map(({ id }) => id),
      ['a1', 'a2', 'b', 'c'],
    );
  });

  test('the draws given are left as they were', () => {
    const given = [draw('x', 'alpha', 2), draw('y', 'opaque'), draw('z', 'alpha', 1)];

    orderDraws(given);
    assert.deepStrictEqual(
      given.map(({ id }) => id),
      ['x', 'y', 'z'],
    );
  });

  test('an opaque draw sorts ahead of blended ones whatever its level', () => {
    const ordered = orderDraws([draw('glass', 'alpha', 0), draw('stone', 'opaque', 32)]);

    assert.strictEqual(ordered[0].id, 'stone');
  });
});
