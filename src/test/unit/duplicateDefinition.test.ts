import * as assert from 'assert';
import {
  duplicateDefinition,
  strRecord,
} from '../../language/model/duplicateDefinition';

suite('Duplicating a definition', () => {
  const lines = [
    'Object DupSoldier ; the original',
    '  DisplayName = OBJECT:DupSoldier',
    '  Description = CONTROLBAR:ToolTipDupSoldier',
    '  CommandSet = DupSoldierCommandSet',
    '  BuildCost = 300',
    'End',
  ];

  test('renames the header and the labels that carry the name, nothing else', () => {
    const copy = duplicateDefinition(lines, 0, 5, 'DupCaptain');

    assert.deepStrictEqual(copy.lines, [
      'Object DupCaptain ; the original',
      '  DisplayName = OBJECT:DupCaptain',
      '  Description = CONTROLBAR:ToolTipDupCaptain',
      '  CommandSet = DupSoldierCommandSet',
      '  BuildCost = 300',
      'End',
    ]);
    assert.deepStrictEqual(copy.labels, [
      { from: 'OBJECT:DupSoldier', to: 'OBJECT:DupCaptain' },
      {
        from: 'CONTROLBAR:ToolTipDupSoldier',
        to: 'CONTROLBAR:ToolTipDupCaptain',
      },
    ]);
  });

  test('a string record quotes its text as the game reads it back', () => {
    assert.strictEqual(
      strRecord('OBJECT:X', 'Say "hi"\nnow', '\r\n'),
      'OBJECT:X\r\n"Say \\"hi\\"\\nnow"\r\nEND\r\n',
    );
  });
});
