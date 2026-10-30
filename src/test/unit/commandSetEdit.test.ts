import * as assert from 'assert';
import {
  readCommandSetName,
  moveSlot,
  hasSameSlots,
  buildSlotEdits,
} from '../../game/objects/commandSetEdit';

const apply = (lines: string[], edits: ReturnType<typeof buildSlotEdits>) => {
  const out = [...lines];

  [...edits]
    .sort((a, b) => b.line - a.line)
    .forEach((edit) => out.splice(edit.line, edit.remove, ...edit.insert));
  return out;
};

suite('Command set editing', () => {
  test('slots are written again in order where the first one was', () => {
    const lines = [
      'CommandSet TestSet',
      '  1 = Command_A',
      '  InitialVisible = 3',
      '  2 = Command_B ; note',
      'End',
    ];

    assert.deepStrictEqual(
      apply(
        lines,
        buildSlotEdits(
          lines,
          0,
          4,
          new Map([
            [5, 'Command_A'],
            [1, 'Command_B'],
          ]),
        ),
      ),
      [
        'CommandSet TestSet',
        '  1 = Command_B',
        '  5 = Command_A',
        '  InitialVisible = 3',
        'End',
      ],
    );
  });

  test('an empty set gets its slots before End', () => {
    const lines = ['CommandSet Empty', 'End'];

    assert.deepStrictEqual(
      apply(lines, buildSlotEdits(lines, 0, 1, new Map([[1, 'Command_A']]))),
      ['CommandSet Empty', '  1 = Command_A', 'End'],
    );
  });
});

suite('Command set moves', () => {
  test('a move into a taken slot swaps, into a free one leaves a gap', () => {
    const slots = new Map([
      [1, 'A'],
      [2, 'B'],
    ]);

    assert.deepStrictEqual([...moveSlot(slots, 1, 2)].sort(), [
      [1, 'B'],
      [2, 'A'],
    ]);
    assert.deepStrictEqual([...moveSlot(slots, 1, 6)].sort(), [
      [2, 'B'],
      [6, 'A'],
    ]);
  });

  test('only a CommandSet header names a set, not a CommandSet field', () => {
    assert.strictEqual(readCommandSetName('CommandSet TestSet'), 'TestSet');
    assert.strictEqual(
      readCommandSetName('  commandset TestSet ; note'),
      'TestSet',
    );
    assert.strictEqual(
      readCommandSetName('CommandSet\tTestSet // note'),
      'TestSet',
    );
    assert.strictEqual(readCommandSetName('  CommandSet = TestSet'), undefined);
    assert.strictEqual(readCommandSetName('  CommandSet =TestSet'), undefined);
    assert.strictEqual(readCommandSetName('  CommandSet=TestSet'), undefined);
    assert.strictEqual(readCommandSetName('  CommandSetX Test'), undefined);
    assert.strictEqual(
      readCommandSetName('CommandSet TestSet = Other'),
      undefined,
    );
  });

  test('slot maps are the same when they hold the same buttons', () => {
    assert.ok(hasSameSlots(new Map([[1, 'A']]), new Map([[1, 'A']])));
    assert.ok(!hasSameSlots(new Map([[1, 'A']]), new Map([[1, 'B']])));
    assert.ok(!hasSameSlots(new Map([[1, 'A']]), new Map()));
  });
});
