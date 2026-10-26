import * as assert from 'assert';
import {
  buttonName,
  copiedButton,
  copiedObject,
  inheritingObject,
  slotLine,
} from '../../language/model/newObject';

const OBJECT = [
  'Object TestArcher',
  '  DisplayName = OBJECT:TestArcherName',
  '  Side = Testland',
  '  Body = ActiveBody ModuleTag_Body',
  '    MaxHealth = 200',
  '  End',
  'End',
];

suite('New objects', () => {
  test('an inheriting object names its parent and its own label', () => {
    assert.deepStrictEqual(
      inheritingObject('TestRanger', 'TestArcher').lines.slice(0, 2),
      [
        'ChildObject TestRanger TestArcher',
        '  DisplayName = OBJECT:TestRanger',
      ],
    );
  });

  test('a copy is renamed and shown by its own label', () => {
    const copy = copiedObject(OBJECT, 0, OBJECT.length - 1, 'TestRanger');

    assert.deepStrictEqual(copy.lines, [
      'Object TestRanger',
      '  DisplayName = OBJECT:TestRanger',
      '  Side = Testland',
      '  Body = ActiveBody ModuleTag_Body',
      '    MaxHealth = 200',
      '  End',
      'End',
    ]);
  });

  test('a button is copied to build the new object, in the next slot', () => {
    const name = buttonName(
      'Command_ConstructTestArcher',
      'TestArcher',
      'TestRanger',
    );
    const button = copiedButton(
      [
        `CommandButton Command_ConstructTestArcher`,
        '  Command = UNIT_BUILD',
        '  Object = TestArcher',
        '  TextLabel = CONTROLBAR:ConstructTestArcher',
        'End',
      ],
      0,
      4,
      name,
      'TestRanger',
    );

    assert.strictEqual(name, 'Command_ConstructTestRanger');
    assert.deepStrictEqual(button.lines, [
      'CommandButton Command_ConstructTestRanger',
      '  Command = UNIT_BUILD',
      '  Object = TestRanger',
      '  TextLabel = CONTROLBAR:ConstructTestRanger',
      'End',
    ]);
    assert.strictEqual(buttonName('BuildIt', 'TestArcher', 'X'), 'BuildIt_X');
    assert.deepStrictEqual(
      slotLine(['CommandSet TestSet', '  1 = A', '  3 = B ; gap', 'End'], name),
      { line: 3, text: '  4 = Command_ConstructTestRanger' },
    );
  });
});
