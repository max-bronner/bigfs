import * as assert from 'assert';
import { hotkeyClashes, hotkeyOf } from '../../language/model/hotkeys';

suite('Hotkey clashes', () => {
  test('the character after a single & is the key', () => {
    assert.strictEqual(hotkeyOf('&Train'), 'T');
    assert.strictEqual(hotkeyOf('Fish && &Chips'), 'C');
    assert.strictEqual(hotkeyOf('No key'), undefined);
  });

  test('two buttons shown together on one key clash', () => {
    const clashes = hotkeyClashes([
      { slot: 1, hotkey: 'A' },
      { slot: 2, hotkey: 'A' },
      { slot: 3, hotkey: 'B' },
    ]);

    assert.deepStrictEqual(
      [...clashes],
      [
        [1, [2]],
        [2, [1]],
      ],
    );
  });

  test('a purchase and the ability it unlocks never show together', () => {
    const slots = [
      { slot: 1, hotkey: 'F', grants: ['testupgrade'] },
      { slot: 2, hotkey: 'F', needs: ['testupgrade'] },
    ];

    assert.strictEqual(hotkeyClashes(slots).size, 0);
  });

  test('a third button on the key still clashes with both', () => {
    const clashes = hotkeyClashes([
      { slot: 1, hotkey: 'F', grants: ['testupgrade'] },
      { slot: 2, hotkey: 'F', needs: ['testupgrade'] },
      { slot: 3, hotkey: 'F' },
    ]);

    assert.deepStrictEqual(
      [...clashes],
      [
        [1, [3]],
        [2, [3]],
        [3, [1, 2]],
      ],
    );
  });

  test('an any-of gate with another way in can show beside the purchase', () => {
    const slots = [
      { slot: 1, hotkey: 'F', grants: ['one'] },
      { slot: 2, hotkey: 'F', needs: ['one', 'two'], needsAny: true },
    ];

    assert.strictEqual(hotkeyClashes(slots).size, 2);
    assert.strictEqual(
      hotkeyClashes([slots[0], { slot: 2, hotkey: 'F', needs: ['one', 'two'] }])
        .size,
      0,
    );
  });
});
