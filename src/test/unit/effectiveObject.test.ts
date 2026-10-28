import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeLineage } from '../../language/model/effectiveObject';
import type { LineageStep } from '../../language/model/effectiveObject';
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

const TEXT = `Object TestParent
  Side = Testland
  BuildCost = 100 ; cheap
  KindOf = SELECTABLE INFANTRY
  Body = ActiveBody ModuleTag_Body
    MaxHealth = 200
  End
  Behavior = PhysicsBehavior ModuleTag_Physics
  End
  WeaponSet
    Conditions = None
    Weapon = PRIMARY TestSword
  End
  WeaponSet
    Conditions = PLAYER_UPGRADE
    Weapon = PRIMARY TestBetterSword
  End
End

ChildObject TestChild TestParent
  BuildCost = 150
  KindOf = +HERO -INFANTRY
  Body = ActiveBody ModuleTag_ChildBody
    MaxHealth = 900
  End
  RemoveModule ModuleTag_Physics
  WeaponSet
    Conditions = None
    Weapon = PRIMARY TestAxe
  End
  Behavior = SlowDeathBehavior ModuleTag_Death
  End
End
`;

suite('Effective objects', () => {
  test('a child composes over its parent by the engine rules', () => {
    const lines = TEXT.split('\n');
    const parsed = parseSageIni(lines, schema);
    const lineage: LineageStep[] = parsed.blocks.map((block) => ({
      name: block.name!.split(/\s+/)[0],
      lines,
      block,
      statements: parsed.statements,
    }));

    assert.strictEqual(
      composeLineage(lineage, 'ChildObject TestChild TestParent'),
      [
        '; The definition as the game builds it, composed from TestParent > TestChild',
        '; Read-only. Each line says where it comes from; edit it there.',
        'ChildObject TestChild TestParent',
        '  Side = Testland  ; TestParent',
        '  BuildCost = 150  ; TestChild: was 100 in TestParent',
        "  KindOf = SELECTABLE HERO  ; TestChild: edits TestParent's: +HERO -INFANTRY",
        "  Body = ActiveBody ModuleTag_ChildBody  ; TestChild: replaces TestParent's",
        '    MaxHealth = 900',
        '  End',
        '  WeaponSet  ; TestChild: replaces 2 inherited WeaponSet',
        '    Conditions = None',
        '    Weapon = PRIMARY TestAxe',
        '  End',
        '  Behavior = SlowDeathBehavior ModuleTag_Death  ; TestChild: added',
        '  End',
        'End',
        '',
      ].join('\n'),
    );
  });
});
