import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readObjectStats,
  readWeaponStats,
} from '../../language/model/objectStats';
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

const TEXT = `#define BASE_COST 200
#define DOUBLE_COST #MULTIPLY( BASE_COST 2 )
#define NAMES Alpha Beta
Object Soldier
  BuildCost = DOUBLE_COST
  BuildTime = #ADD( BASE_COST 25 )
  VisionRange = 150
End
Weapon Sword
  AttackRange = 30
  DelayBetweenShots = 1000
  DamageNugget
    Damage = 10
  End
  DamageNugget
    Damage = BASE_COST
  End
End
Weapon Spear
  DamageNugget
    Damage = 40
  End
End
Weapon Broken
  DamageNugget
    Damage = 5
  End
  DamageNugget
    Damage = NAMES
  End
End
`;

const lines = TEXT.split('\n');
const parsed = parseSageIni(lines, schema);
const macros = new Map(
  parsed.macros.map((macro) => [macro.name.toLowerCase(), macro.value]),
);
const evaluation = {
  lines,
  lookupMacro: (name: string) => macros.get(name.toLowerCase()),
};
const block = (name: string) =>
  parsed.blocks.find((each) => each.name === name)!;

suite('Object stats', () => {
  test('macros and calls are shown as the numbers they stand for', () => {
    const { values } = readObjectStats(parsed, block('Soldier'), evaluation);

    assert.strictEqual(values.cost?.value, '400');
    assert.strictEqual(values.cost?.written, 'DOUBLE_COST');
    assert.strictEqual(values.time?.value, '225');
    assert.strictEqual(values.time?.written, '#ADD( BASE_COST 25 )');
    assert.strictEqual(values.vision?.value, '150');
    assert.strictEqual(values.vision?.written, undefined);
  });

  test('without an evaluation the tokens are kept', () => {
    const { values } = readObjectStats(parsed, block('Soldier'));

    assert.strictEqual(values.cost?.value, 'DOUBLE_COST');
  });

  test('a weapon sums its damage nuggets', () => {
    const sword = readWeaponStats(parsed, block('Sword'), evaluation);

    assert.strictEqual(sword.damage, undefined);
    assert.deepStrictEqual(sword.damageTotal, { value: '210', nuggets: 2 });
    assert.strictEqual(sword.range?.value, '30');
    assert.strictEqual(sword.delay?.value, '1000');
  });

  test('one nugget stays editable in place; an unreadable one is listed', () => {
    const spear = readWeaponStats(parsed, block('Spear'), evaluation);
    const broken = readWeaponStats(parsed, block('Broken'), evaluation);

    assert.strictEqual(spear.damage?.value, '40');
    assert.strictEqual(spear.damageTotal, undefined);
    assert.strictEqual(broken.damageTotal?.value, '5 + NAMES');
  });
});
