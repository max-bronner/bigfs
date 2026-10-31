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

  test('a condition on the previous state is decided when that state is known', () => {
    const script = [
      'Prev = CurDrawablePrevAnimationState()',
      'if Prev == "Fire" or Prev == "Reload" then',
      '  CurDrawableHideSubObject("A")',
      'elseif Prev ~= "Idle" then',
      '  CurDrawableHideSubObject("B")',
      'else',
      '  CurDrawableHideSubObject("C")',
      'end',
      'if CurDrawableAllowToContinue() and Prev == "Fire" then',
      '  CurDrawableHideSubObject("D")',
      'end',
      'if CurDrawableAllowToContinue() and Prev == "Idle" then',
      '  CurDrawableHideSubObject("E")',
      'end',
    ].join('\n');
    const named = (previous?: string | null) => {
      const { rules, conditional } = readStateScript(script, 'S', previous);

      return [rules.map((each) => each.pattern), conditional];
    };

    assert.deepStrictEqual(named('Fire'), [['A'], ['D (S)']]);
    assert.deepStrictEqual(named('Idle'), [['C'], ['E (S)']]);
    assert.deepStrictEqual(named(null), [['B'], []]);
    assert.deepStrictEqual(named()[1], ['A (S)', 'B (S)', 'C (S)', 'D (S)', 'E (S)']);
  });

  test('an or with one side undecided stays undecided unless the other is true', () => {
    const script = (test: string) =>
      `Prev = CurDrawablePrevAnimationState()
if ${test} then
  CurDrawableHideSubObject("A")
end`;
    const unknown = 'CurDrawableAllowToContinue()';

    assert.deepStrictEqual(
      readStateScript(script(`${unknown} or Prev == "Idle"`), 'S', 'Fire').conditional,
      ['A (S)'],
    );
    assert.deepStrictEqual(
      readStateScript(script(`${unknown} or Prev == "Fire"`), 'S', 'Fire').rules.length,
      1,
    );
  });

  test('a variable set under a condition is no longer known', () => {
    const script = [
      'local Prev = CurDrawablePrevAnimationState()',
      'if CurDrawableAllowToContinue() then',
      '  Prev = "Fire"',
      'end',
      'if Prev == "Fire" then',
      '  CurDrawableHideSubObject("A")',
      'end',
    ].join('\n');

    assert.deepStrictEqual(readStateScript(script, 'S', 'Fire').conditional, ['A (S)']);
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
    assert.deepStrictEqual(grantedUpgrades, [{ name: 'Upgrade_Rock', at: 3 }]);
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
    '    HideSubObjects = CLUB BLADE',
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
    assert.deepStrictEqual(scene.upgrades.map((each) => each.shows), [
      ['BANNER'],
      ['BOULDER'],
      ['ALWAYS'],
    ]);
    assert.deepStrictEqual(scene.upgrades[1].hides, ['CLUB', 'BLADE']);
    assert.deepStrictEqual(
      scene.states.find((each) => each.label === 'AnimationState = MOVING')
        ?.subObjects.conditional,
      ['MAYBE (AnimationState = MOVING script)'],
    );
  });

  test('a model state shows its idle state script; an upgrade writes nothing until it fires', () => {
    const scene = read();
    const model = scene.states.find((each) => each.kind === 'model');

    assert.deepStrictEqual(
      listSubObjectRules(scene, model).map(({ pattern, hide }) => [pattern, hide]),
      [
        ['ARROW', true],
        ['ALWAYS', false],
      ],
    );
  });

  test('plain writes of a previous state last, and come before every permanent write', () => {
    const scene = read();
    const moving = scene.states.find((each) => each.label === 'AnimationState = MOVING');

    assert.deepStrictEqual(
      listSubObjectRules(scene, moving).map(({ pattern, hide }) => [pattern, hide]),
      [
        ['ARROW', true],
        ['CLUB', false],
        ['BANNER', false],
        ['ALWAYS', false],
        ['ROCK', false],
      ],
    );
  });

  test('a later write of a name takes the turn of the first', () => {
    const scene = read();
    const moving = scene.states.find((each) => each.label === 'AnimationState = MOVING')!;

    moving.subObjects.rules = [
      { pattern: 'ARROW', hide: false, isPermanent: false, source: 'MOVING' },
      { pattern: 'BANNER', hide: true, isPermanent: false, source: 'MOVING' },
      { pattern: 'arrow', hide: true, isPermanent: false, source: 'MOVING again' },
    ];
    assert.deepStrictEqual(
      listSubObjectRules(scene, moving)
        .slice(0, 2)
        .map(({ pattern, source }) => [pattern, source]),
      [
        ['arrow', 'MOVING again'],
        ['BANNER', 'MOVING'],
      ],
    );
  });

  test('a state with another model drops creation plain writes unless it retains them', () => {
    const scene = read();
    const model = scene.states.find((each) => each.kind === 'model')!;
    const plain = { pattern: 'PLAIN', hide: true, isPermanent: false, source: 'OnCreated' };
    const other = { ...model, model: 'OTHER_SKN' };

    scene.created.rules = [plain];
    assert.ok(listSubObjectRules(scene, model).some((each) => each.pattern === 'PLAIN'));
    assert.ok(!listSubObjectRules(scene, other).some((each) => each.pattern === 'PLAIN'));
    assert.ok(
      listSubObjectRules(scene, { ...other, retainsSubObjects: true }).some(
        (each) => each.pattern === 'PLAIN',
      ),
    );
  });

  test('a damaged state writes its damage lists over the pristine ones, hides first', () => {
    const scene = read();
    const model = scene.states.find((each) => each.kind === 'model')!;
    const write = (pattern: string, hide: boolean) => ({ pattern, hide, source: 'test' });

    scene.damageSubObjects.pristine = [write('ROOF', false), write('RUIN', true)];
    scene.damageSubObjects.damaged = [write('RUIN', false), write('ROOF', true)];
    scene.damageSubObjects.rubble = [write('STUMP', false)];

    const permanent = (label: string) =>
      listSubObjectRules(scene, { ...model, label })
        .slice(1)
        .map(({ pattern, hide }) => [pattern, hide]);

    assert.deepStrictEqual(permanent('ModelConditionState = None').slice(0, 2), [
      ['RUIN', true],
      ['ROOF', false],
    ]);
    assert.deepStrictEqual(permanent('ModelConditionState = DAMAGED').slice(0, 2), [
      ['RUIN', false],
      ['ROOF', true],
    ]);
    assert.ok(
      permanent('ModelConditionState = REALLYDAMAGED').some(
        ([pattern, hide]) => pattern === 'ROOF' && hide === false,
      ),
    );
    assert.ok(permanent('ModelConditionState = RUBBLE').some(([name]) => name === 'STUMP'));
  });

  test('a write reaches the parts on bones below its own, not those beside or on the root', () => {
    const parents = [0, 0, 1, 2, 0];
    const parts = [
      { ...mesh('ROOT'), bone: 0 },
      { ...mesh('ARM'), bone: 1 },
      { ...mesh('WRIST'), bone: 2 },
      { ...mesh('CLUB'), bone: 3 },
      { ...mesh('BESIDE'), bone: 1 },
      { ...mesh('LEG'), bone: 4 },
      mesh('SKIN'),
    ];

    assert.deepStrictEqual(findHidingSources(parts, [rule('ARM')], parents), [
      undefined,
      'test',
      'test',
      'test',
      undefined,
      undefined,
      undefined,
    ]);
    assert.deepStrictEqual(
      findHidingSources(parts, [rule('ARM'), rule('WRIST', false)], parents).slice(1, 4),
      ['test', undefined, undefined],
    );
    assert.deepStrictEqual(
      findHidingSources(parts, [rule('ROOT')], parents).filter(Boolean),
      ['test'],
    );
    assert.deepStrictEqual(
      findHidingSources(parts, [rule('ARM')]).filter(Boolean),
      ['test'],
    );
  });

  test('a skeleton whose parents loop ends', () => {
    assert.deepStrictEqual(
      findHidingSources([{ ...mesh('A'), bone: 1 }, { ...mesh('B'), bone: 2 }], [rule('A')], [0, 2, 3, 2]),
      ['test', undefined],
    );
  });

  test('upgrades fire at their grant, over creation, and permanent calls over those', () => {
    const scene = read();
    const moving = scene.states.find((each) => each.label === 'AnimationState = MOVING');

    scene.created = {
      rules: [
        { pattern: 'CLUB', hide: true, isPermanent: true, source: 'OnBeastCreated' },
        { pattern: 'ROCK', hide: true, isPermanent: true, source: 'OnBeastCreated' },
      ],
      conditional: ['WHO (OnBeastCreated)'],
      grantedUpgrades: [{ name: 'upgrade_rock', at: 1 }],
    };

    const parts = [mesh('CLUB'), mesh('BANNER'), mesh('ROCK'), mesh('BOULDER')];

    assert.deepStrictEqual(
      findHidingSources(parts, listSubObjectRules(scene, moving)),
      ['upgrade Upgrade_Rock', undefined, undefined, undefined],
    );
    assert.deepStrictEqual(listConditionalSubObjects(scene, moving), [
      'MAYBE (AnimationState = MOVING script)',
      'WHO (OnBeastCreated)',
    ]);
  });

  test('a state reads the previous state as its idle, idle as none', () => {
    const lines = [
      'Object TestBeast',
      '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
      '    DefaultModelConditionState',
      '      Model = TB_SKN',
      '    End',
      '    IdleAnimationState',
      '      StateName = STATE_Rest',
      '      BeginScript',
      '        Prev = CurDrawablePrevAnimationState()',
      '        if Prev == "STATE_Rest" then',
      '          CurDrawableHideSubObject("NEVER")',
      '        end',
      '      EndScript',
      '    End',
      '    AnimationState = MOVING',
      '      Animation = Run',
      '        AnimationName = TB_SKL.TB_RUNA',
      '      End',
      '      BeginScript',
      '        Prev = CurDrawablePrevAnimationState()',
      '        if Prev == "STATE_Rest" then',
      '          CurDrawableHideSubObject("BLADE")',
      '        end',
      '      EndScript',
      '    End',
      '  End',
      'End',
    ];
    const scene = readObjectScene(
      parseSageIni(lines, schema),
      schema,
      () => false,
      () => false,
      lines,
    )!;

    assert.deepStrictEqual(
      scene.states.flatMap((each) => each.subObjects.rules.map((rule) => rule.pattern)),
      ['BLADE'],
    );
    assert.deepStrictEqual(
      scene.states.flatMap((each) => each.subObjects.conditional),
      [],
    );
  });

  test('without the text the scripts are left unread', () => {
    const scene = readObjectScene(parsed, schema, () => false, () => false)!;

    assert.deepStrictEqual(
      scene.states.flatMap((each) => each.subObjects.rules),
      [],
    );
  });
});
