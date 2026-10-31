import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import {
  findHidingSources,
  getMeshVisibility,
  isSubObjectNamed,
} from '../../formats/w3d/w3dScene';
import { readObjectScene } from '../../game/objects/objectScene';
import {
  listConditionalSubObjects,
  listSubObjectRules,
} from '../../game/objects/subObjectRules';
import {
  readCreatedSubObjects,
  readStateScript,
} from '../../game/objects/subObjectScripts';

// Invented names and scripts; only the grammar and the call names are the games'
const mesh = (name: string, hidden = false) => ({
  name,
  container: 'UNIT_SKN',
  hidden,
});
const rule = (pattern: string, hide = true, source = 'test') => ({
  pattern,
  hide,
  source,
});

suite('Sub-object visibility', () => {
  test('a pattern matches the full name or the part after the dot, without casing', () => {
    assert.ok(isSubObjectNamed(mesh('CLUB'), 'club'));
    assert.ok(isSubObjectNamed(mesh('CLUB'), 'unit_skn.Club'));
    assert.ok(!isSubObjectNamed(mesh('CLUB'), 'CLU'));
    assert.ok(!isSubObjectNamed(mesh('CLUB'), 'OTHER.CLUB'));
  });

  test('a final star matches by prefix, on either name', () => {
    assert.ok(isSubObjectNamed(mesh('FIRE_TIP01'), 'fire_*'));
    assert.ok(isSubObjectNamed(mesh('FIRE_TIP01'), 'UNIT_*'));
    assert.ok(!isSubObjectNamed(mesh('TIP_FIRE'), 'FIRE*'));
  });

  test('the last write naming a mesh decides, and says where it came from', () => {
    const meshes = [mesh('A'), mesh('B', true), mesh('C')];
    const rules = [
      rule('A', true, 'first'),
      rule('A', false, 'second'),
      rule('B', false, 'third'),
      rule('C', false, 'fourth'),
      rule('C', true, 'fifth'),
    ];

    assert.deepStrictEqual(findHidingSources(meshes, rules), [
      undefined,
      undefined,
      'fifth',
    ]);
    assert.deepStrictEqual(findHidingSources(meshes), [
      undefined,
      'the W3D HIDDEN flag',
      undefined,
    ]);
  });

  test('rules, the show-hidden switch and the user choice combine', () => {
    const scene = { meshes: [mesh('A'), mesh('B'), mesh('C', true)] };
    const subObjectRules = [rule('A')];

    assert.deepStrictEqual(getMeshVisibility(scene, { subObjectRules }), [
      false,
      true,
      false,
    ]);
    assert.deepStrictEqual(
      getMeshVisibility(scene, { subObjectRules, showHidden: true }),
      [true, true, true],
    );
    assert.deepStrictEqual(
      getMeshVisibility(scene, {
        subObjectRules,
        showHidden: true,
        partOverrides: new Map([[1, false]]),
      }),
      [true, false, true],
    );
    assert.deepStrictEqual(
      getMeshVisibility(scene, {
        subObjectRules,
        partOverrides: new Map([
          [0, true],
          [2, true],
        ]),
      }),
      [true, true, true],
    );
  });

  test('a user choice does not bring back another level of detail', () => {
    const scene = {
      meshes: [mesh('LOW'), mesh('HIGH')],
      hlod: {
        name: 'UNIT',
        lods: [{ meshes: [0] }, { meshes: [1] }],
        skippedLodCount: 0,
        aggregates: [],
        proxies: [],
      },
    };

    assert.deepStrictEqual(
      getMeshVisibility(scene, { partOverrides: new Map([[0, true]]) }),
      [false, true],
    );
  });
});

suite('Sub-object scripts', () => {
  test('a state script writes its plain and permanent calls in order', () => {
    const { rules, conditional } = readStateScript(
      [
        'CurDrawableHideSubObject("ARROW")',
        'CurDrawableShowSubObject("BOW*")',
        'CurDrawableHideSubObjectPermanently("TORCH")',
        'CurDrawableShowSubObjectPermanently("ROCK")',
      ].join('\n'),
      'Run script',
    );

    assert.deepStrictEqual(
      rules.map(({ pattern, hide, isPermanent, source }) => [
        pattern,
        hide,
        isPermanent,
        source,
      ]),
      [
        ['ARROW', true, false, 'Run script'],
        ['BOW*', false, false, 'Run script'],
        ['TORCH', true, true, 'Run script'],
        ['ROCK', false, true, 'Run script'],
      ],
    );
    assert.deepStrictEqual(conditional, []);
  });

  test('a call under a condition or past a possible return is listed, not applied', () => {
    const { rules, conditional } = readStateScript(
      [
        'Prev = CurDrawablePrevAnimationState()',
        'CurDrawableHideSubObject("ALWAYS")',
        'if Prev == "Fire" then',
        '  CurDrawableShowSubObject("ONLY_IF")',
        '  return "Quick"',
        'end',
        'CurDrawableHideSubObject("AFTER")',
        'CurDrawableHideSubObject(Prev)',
      ].join('\n'),
      'S',
    );

    assert.deepStrictEqual(rules.map((each) => each.pattern), ['ALWAYS']);
    assert.deepStrictEqual(conditional, [
      'ONLY_IF (S)',
      'AFTER (S)',
      'a computed name (S)',
    ]);
  });

  test('the INI comments a script is written with are not read as Lua', () => {
    const { rules, conditional } = readStateScript(
      [
        'CurDrawableHideSubObject("A") ;keeps the blend right',
        ';CurDrawableHideSubObject("B")',
        'CurDrawableHideSubObject("C") // it does not matter',
        "CurDrawableHideSubObject('D;E')",
      ].join('\n'),
      'S',
    );

    assert.deepStrictEqual(rules.map((each) => each.pattern), ['A', 'C', 'D;E']);
    assert.deepStrictEqual(conditional, []);
  });

  test('a script that does not parse is reported, not thrown', () => {
    assert.deepStrictEqual(
      readStateScript('CurDrawableHideSubObject(', 'S').conditional,
      ['S, whose Lua could not be read'],
    );
    assert.deepStrictEqual(readStateScript('garbage (', 'S').conditional, []);
  });

  const EVENTS = `<?xml version="1.0"?>
    <!-- <EventList Name="Ghost"><EventHandler EventName="OnCreated" ScriptFunctionName="Nope"/></EventList> -->
    <EventList Name="Base">
      <EventHandler EventName="OnCreated" ScriptFunctionName="OnBaseCreated" DebugSingleStep="false"/>
    </EventList>
    <EventList Name="Beast" Inherit="Base">
      <EventHandler EventName="OnCreated" ScriptFunctionName="OnBeastCreated"/>
    </EventList>
    <EventList Name="Pup" Inherit="Base">
      <EventHandler ScriptFunctionName="Hurt" EventName="OnDamaged"/>
    </EventList>
    <EventList Name="LoopA" Inherit="LoopB"></EventList>
    <EventList Name="LoopB" Inherit="LoopA"></EventList>`;
  const SCRIPTS = `
    function Shared(self)
      ObjectHideSubObjectPermanently( self, "SHARED", true )
    end
    function OnBaseCreated(self)
      ObjectHideSubObjectPermanently( self, "BASE", true )
    end
    function OnBeastCreated(self)
      ObjectHideSubObjectPermanently( self, "CLUB", true )
      ObjectHideSubObjectPermanently( self, "SHOWN", false )
      ObjectHideSubObject( self, "PLAIN", true )
      ObjectGrantUpgrade( self, "Upgrade_Rock" )
      Shared(self)
      if GetRandomNumber() <= 0.5 then
        ObjectHideSubObjectPermanently( self, "MAYBE", true )
        ObjectGrantUpgrade( self, "Upgrade_Maybe" )
      end
    end`;

  test('the OnCreated handler a list binds is read, helpers included, chance left out', () => {
    const { rules, conditional, grantedUpgrades } = readCreatedSubObjects(
      ['Beast'],
      EVENTS,
      SCRIPTS,
    );

    assert.deepStrictEqual(
      rules.map(({ pattern, hide }) => [pattern, hide]),
      [
        ['CLUB', true],
        ['SHOWN', false],
        ['PLAIN', true],
        ['SHARED', true],
      ],
    );
    assert.deepStrictEqual(conditional, ['MAYBE (OnBeastCreated in scripts.lua)']);
    assert.deepStrictEqual(grantedUpgrades, ['Upgrade_Rock']);
  });

  test('a list without the handler inherits it, a cycle ends, an unknown name binds nothing', () => {
    assert.deepStrictEqual(
      readCreatedSubObjects(['Pup'], EVENTS, SCRIPTS).rules.map((each) => each.source),
      ['OnBaseCreated in scripts.lua'],
    );
    assert.deepStrictEqual(readCreatedSubObjects(['LoopA'], EVENTS, SCRIPTS).rules, []);
    assert.deepStrictEqual(readCreatedSubObjects(['Ghost'], EVENTS, SCRIPTS).rules, []);
  });
});

suite('Sub-objects of an object', () => {
  const schema = createSageIniSchema(
    JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
        'utf8',
      ),
    ),
  );
  const TEXT = [
    'Object TestBeast',
    '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
    '    DefaultModelConditionState',
    '      Model = TB_SKN',
    '    End',
    '    IdleAnimationState',
    '      Animation = Idle',
    '        AnimationName = TB_SKL.TB_IDLA',
    '      End',
    '      BeginScript',
    '        CurDrawableHideSubObject("ARROW")',
    '      EndScript',
    '    End',
    '    AnimationState = MOVING',
    '      Animation = Run',
    '        AnimationName = TB_SKL.TB_RUNA',
    '      End',
    '      BeginScript',
    '        CurDrawableShowSubObject("CLUB")',
    '        CurDrawableShowSubObject("BANNER")',
    '        CurDrawableShowSubObjectPermanently("ROCK")',
    '        if CurDrawableAllowToContinue() then',
    '          CurDrawableHideSubObject("MAYBE")',
    '        end',
    '      EndScript',
    '    End',
    '  End',
    '  Behavior = AIUpdateInterface ModuleTag_AI',
    '    AILuaEventsList = BeastFunctions',
    '  End',
    '  Behavior = SubObjectsUpgrade ModuleTag_Banner',
    '    TriggeredBy = Upgrade_Banner',
    '    ShowSubObjects = BANNER',
    '  End',
    '  Behavior = SubObjectsUpgrade ModuleTag_Rock',
    '    TriggeredBy = Upgrade_Rock',
    '    ShowSubObjects = BOULDER',
    '  End',
    '  Behavior = SubObjectsUpgrade ModuleTag_Always',
    '    TriggeredBy = Upgrade_Other',
    '    StartsActive = Yes',
    '    ShowSubObjects = ALWAYS',
    '  End',
    'End',
  ];
  const parsed = parseSageIni(TEXT, schema);
  const read = () =>
    readObjectScene(parsed, schema, () => false, () => false, TEXT)!;

  test('a state keeps its script, the object its upgrades and event lists', () => {
    const scene = read();

    assert.deepStrictEqual(scene.luaEventLists, ['BeastFunctions']);
    assert.deepStrictEqual(scene.upgrades.map((each) => each.parts), [
      ['BANNER'],
      ['BOULDER'],
      ['ALWAYS'],
    ]);
    assert.deepStrictEqual(
      scene.states.find((each) => each.label === 'AnimationState = MOVING')
        ?.subObjects.conditional,
      ['MAYBE (AnimationState = MOVING script)'],
    );
  });

  test('a model state shows its idle state script; an upgrade waits for its trigger', () => {
    const scene = read();
    const model = scene.states.find((each) => each.kind === 'model');

    assert.deepStrictEqual(
      listSubObjectRules(scene, model).map(({ pattern, hide }) => [pattern, hide]),
      [
        ['ARROW', true],
        ['BANNER', true],
        ['BOULDER', true],
      ],
    );
  });

  test('upgrades and creation write over a state, permanent calls over those', () => {
    const scene = read();
    const moving = scene.states.find((each) => each.label === 'AnimationState = MOVING');

    scene.created = {
      rules: [
        { pattern: 'CLUB', hide: true, isPermanent: true, source: 'OnBeastCreated' },
        { pattern: 'ROCK', hide: true, isPermanent: true, source: 'OnBeastCreated' },
      ],
      conditional: ['WHO (OnBeastCreated)'],
      grantedUpgrades: ['upgrade_rock'],
    };

    const parts = [mesh('CLUB'), mesh('BANNER'), mesh('ROCK'), mesh('BOULDER')];

    assert.deepStrictEqual(
      findHidingSources(parts, listSubObjectRules(scene, moving)),
      ['OnBeastCreated', 'until Upgrade_Banner', undefined, undefined],
    );
    assert.deepStrictEqual(listConditionalSubObjects(scene, moving), [
      'MAYBE (AnimationState = MOVING script)',
      'WHO (OnBeastCreated)',
    ]);
  });

  test('without the text the scripts are left unread', () => {
    const scene = readObjectScene(parsed, schema, () => false, () => false)!;

    assert.deepStrictEqual(
      scene.states.flatMap((each) => each.subObjects.rules),
      [],
    );
  });
});
