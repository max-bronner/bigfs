import * as assert from 'assert';
import { hotkeyClashes, hotkeyOf } from '../../language/model/hotkeys';

suite('Hotkeys', () => {
  test('the key is the letter after a single ampersand', () => {
    assert.strictEqual(hotkeyOf('&Build Barracks'), 'B');
    assert.strictEqual(hotkeyOf('Train &swordsmen'), 'S');
    assert.strictEqual(hotkeyOf('Salt && &Pepper'), 'P');
    assert.strictEqual(hotkeyOf('No key'), undefined);
  });

  test('slots sharing a key clash with each other, others do not', () => {
    assert.deepStrictEqual(
      [
        ...hotkeyClashes([
          { slot: 1, hotkey: 'S' },
          { slot: 2, hotkey: 'B' },
          { slot: 4, hotkey: 'S' },
          { slot: 5 },
        ]),
      ],
      [
        [1, [4]],
        [4, [1]],
      ],
    );
  });
});
