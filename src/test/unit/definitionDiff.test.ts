import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { diffDefinitions } from '../../game/objects/definitionDiff';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

const read = (text: string) => {
  const lines = text.split('\n');

  return { document: parseSageIni(lines, schema), lines };
};

const BASE = `Object TestUnit
  BuildCost = 100 ; cheap
  Body = ActiveBody ModuleTag_Body
    MaxHealth = 200
  End
  WeaponSet
    Weapon = PRIMARY TestSword
  End
End

Object TestGone
  BuildCost = 1
End
`;

const MOD = `Object TestUnit
  BuildCost   = 120
  Body = ActiveBody ModuleTag_Body
    MaxHealth = 200
  End
  WeaponSet
    Weapon = PRIMARY TestAxe
  End
  Behavior = PhysicsBehavior ModuleTag_Physics
  End
End

Object TestNew
  BuildCost = 5
End
`;

suite('Definition diff', () => {
  test('definitions added, removed, and changed value by value', () => {
    assert.deepStrictEqual(diffDefinitions(read(BASE), read(MOD)), {
      added: ['Object TestNew'],
      removed: ['Object TestGone'],
      changed: [
        {
          name: 'Object TestUnit',
          changes: [
            { path: 'BuildCost', before: '100', after: '120' },
            {
              path: 'WeaponSet/Weapon',
              before: 'PRIMARY TestSword',
              after: 'PRIMARY TestAxe',
            },
            {
              path: 'Behavior[ModuleTag_Physics]',
              before: undefined,
              after: 'PhysicsBehavior ModuleTag_Physics',
            },
          ],
        },
      ],
    });
  });
});
