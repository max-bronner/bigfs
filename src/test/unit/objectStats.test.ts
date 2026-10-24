import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import {
  readObjectStats,
  readWeaponStats,
} from '../../language/model/objectStats';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

// Invented values; only the grammar is the games'
const TEXT = [
  'Object TestSoldier',
  '  Side = Men',
  '  KindOf = PRELOAD SELECTABLE INFANTRY',
  '  BuildCost = 300',
  '  BuildTime = 30',
  '  CommandPoints = 40',
  '  VisionRange = 400',
  '  ArmorSet',
  '    Conditions = None',
  '    Armor = TestArmor',
  '  End',
  '  WeaponSet',
  '    Conditions = None',
  '    Weapon = PRIMARY TestSword',
  '  End',
  '  LocomotorSet',
  '    Locomotor = TestLocomotor',
  '    Condition = SET_NORMAL',
  '    Speed = 55',
  '  End',
  '  Body = ActiveBody ModuleTag_Body',
  '    MaxHealth = 200',
  '  End',
  'End',
  'ChildObject TestCaptain TestSoldier',
  '  BuildCost = 500',
  'End',
  'Weapon TestSword',
  '  AttackRange = 30',
  '  DelayBetweenShots = 2000',
  '  DamageNugget',
  '    Damage = 45',
  '    DamageType = SLASH',
  '  End',
  'End',
];

suite('Object stats', () => {
  const parsed = parseSageIni(TEXT, schema);
  const [soldier, captain, sword] = parsed.blocks;

  test('reads the numbers a balance pass compares, with where each is written', () => {
    const stats = readObjectStats(parsed, soldier);

    assert.strictEqual(stats.name, 'TestSoldier');
    assert.ok(stats.selectable);
    assert.deepStrictEqual(
      Object.fromEntries(
        Object.entries(stats.values).map(([column, value]) => [
          column,
          value!.value,
        ]),
      ),
      {
        side: 'Men',
        cost: '300',
        time: '30',
        commandPoints: '40',
        vision: '400',
        armor: 'TestArmor',
        weapon: 'TestSword',
        speed: '55',
        health: '200',
      },
    );
    assert.deepStrictEqual(stats.values.health, {
      value: '200',
      line: 21,
      start: 16,
      end: 19,
    });
  });

  test('a child names its parent and writes only what it changes', () => {
    const stats = readObjectStats(parsed, captain);

    assert.strictEqual(stats.parent, 'TestSoldier');
    assert.deepStrictEqual(Object.keys(stats.values), ['cost']);
  });

  test('a weapon gives its first damage nugget, range and delay', () => {
    const stats = readWeaponStats(parsed, sword);

    assert.deepStrictEqual(
      [stats.damage?.value, stats.range?.value, stats.delay?.value],
      ['45', '30', '2000'],
    );
  });
});
