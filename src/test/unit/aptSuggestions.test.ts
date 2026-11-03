import * as assert from 'assert';
import {
  findBindingSuggestion,
  findExternSuggestion,
  findImageSuggestion,
  findParameterSuggestion,
} from '../../game/apt/engineSuggestions';
import type { SuggestionKind, SuggestionRule } from '../../game/apt/suggestionKinds';
import type { HeroSystem } from '../../game/objects/cahSystem';
import { MAX_OPTIONS, resolveSuggestions } from '../../features/apt/aptSuggestions';
import type { SuggestionSources } from '../../features/apt/aptSuggestions';

/** A synthetic INI: files by name, each with blocks written as the games do */
const files: Record<string, string> = {
  'players.ini': [
    'PlayerTemplate FactionMen',
    '  Side = Men',
    '  PlayableSide = Yes',
    '  Evil = No',
    'End',
    'PlayerTemplate FactionMordor',
    '  Side = Mordor ; the dark',
    '  PlayableSide = Yes',
    '  Evil = Yes',
    'End',
    'PlayerTemplate FactionArnor',
    '  Side = Arnor',
    '  PlayableSide = No',
    '  Evil = No',
    'End',
    'PlayerTemplate FactionMenAgain',
    '  Side = men',
    'End',
  ].join('\r\n'),
  'buttons.ini': [
    'CommandButton Command_A',
    '  ButtonImage = BTA',
    'End',
    'CommandButton Command_B',
    '  ButtonImage = BTB',
    '  Science = SCIENCE_B',
    'End',
    'CommandButton Command_C',
    '  ButtonImage = bta',
    'End',
    'CommandButton Command_D',
    '  ButtonImage = BTD		// the dark one',
    'End',
    'CommandButton Command_NoImage',
    'End',
    'CommandButton Command_PowerOne',
    '  ButtonImage = PowerOne',
    '  CreateAHeroUIAllowableUpgrades = Upgrade_A',
    'End',
    'CommandButton Command_SpecialAbilityNoPowerDummy',
    '  ButtonImage = NoPower',
    'End',
    'CommandButton Command_PowerNone',
    '  ButtonImage = PowerNone',
    '  CreateAHeroUIAllowableUpgrades = None',
    'End',
  ].join('\n'),
  'colours.ini': [
    'MultiplayerColor ColorBlue',
    '  RGBColor = R:70 G:91 B:156',
    'End',
    'MultiplayerColor ColorBlack',
    '  RGBColor = R:0 G:0 B:0',
    'End',
    'MultiplayerColor ColorNoRgb',
    '  TooltipName = Color:None',
    'End',
  ].join('\n'),
  'objects.ini': [
    'Object AragornBase',
    '  KindOf = HERO CAN_ATTACK',
    '  ButtonImage = HeroAragorn',
    '  SelectPortrait = PortraitAragorn',
    'End',
    'ChildObject AragornElessar AragornBase',
    '  ButtonImage = HeroElessar',
    'End',
    'ChildObject AragornCamo AragornBase',
    '  SelectPortrait = PortraitCamo',
    'End',
    'Object Grunt',
    '  KindOf = INFANTRY',
    '  ButtonImage = GruntImage',
    '  SelectPortrait = portraitaragorn',
    'End',
    'ChildObject GruntElite Grunt',
    '  ButtonImage = GruntEliteImage',
    'End',
    'Object HeroNoImage',
    '  KindOf = HERO',
    'End',
    'ChildObject HeroEdited Grunt',
    '  KindOf = +HERO',
    '  ButtonImage = HeroEdited',
    'End',
  ].join('\n'),
};

/** What the composed text of each child object reads, as the effective object view prints it */
const composed: Record<string, string> = {
  AragornElessar: ['ChildObject AragornElessar AragornBase', '  KindOf = HERO CAN_ATTACK ; from AragornBase', '  ButtonImage = HeroElessar'].join('\n'),
  GruntElite: ['ChildObject GruntElite Grunt', '  KindOf = INFANTRY', '  ButtonImage = GruntEliteImage'].join('\n'),
  HeroEdited: ['ChildObject HeroEdited Grunt', '  KindOf = INFANTRY HERO', '  ButtonImage = HeroEdited'].join('\n'),
};

interface Definition {
  uri: { toString(): string };
  line: number;
  endLine: number;
  name: string;
  keyword: string;
}

const define = (
  keywords: readonly string[],
  namespace: string,
  file: string,
): [string, Map<string, Definition>] => {
  const lines = files[file].split(/\r?\n/);
  const found = new Map<string, Definition>();

  lines.forEach((text, line) => {
    const match = new RegExp(`^(${keywords.join('|')})\\s+(\\S+)`).exec(text);

    if (match) {
      found.set(match[2], {
        uri: { toString: () => file },
        line,
        endLine: lines.indexOf('End', line),
        name: match[2],
        keyword: match[1],
      });
    }
  });
  return [namespace, found];
};

const names = (list: string[]) => list.map((value) => ({ value }));
const values = (options: { value: string }[]) => options.map((each) => each.value);

const createSources = (
  mapped: string[] = [],
  tables: [string, Map<string, Definition>][] = [
    define(['PlayerTemplate'], 'PlayerTemplate', 'players.ini'),
    define(['CommandButton'], 'CommandButton', 'buttons.ini'),
    define(['MultiplayerColor'], 'MultiplayerColor', 'colours.ini'),
    define(['Object', 'ChildObject'], 'Object', 'objects.ini'),
  ],
  heroSystem?: HeroSystem,
): SuggestionSources & { composedNames: string[] } => {
  const byNamespace = new Map(tables);
  const composedNames: string[] = [];

  byNamespace.set('MappedImage', new Map(mapped.map((name) => [name, { name } as Definition])));
  return {
    composedNames,
    index: {
      getNames: (namespace) => [...(byNamespace.get(namespace)?.keys() ?? [])].sort(),
      findDefinitions: (namespace, name) =>
        [byNamespace.get(namespace)?.get(name)].filter(Boolean) as never,
    },
    read: async (uri) => files[uri.toString()],
    readHeroSystem: async () => heroSystem,
    composeObject: async (uri, line) => {
      const name = files[uri.toString()].split('\n')[line].split(' ')[1];

      composedNames.push(name);
      return composed[name];
    },
  };
};

const resolve = (kind: SuggestionKind, sources = createSources()) =>
  resolveSuggestions(kind, sources);

const fixedValues = (rule: SuggestionRule | undefined): string[] =>
  rule && 'fixed' in rule ? rule.fixed.options.map((each) => each.value) : [];

const kindOf = (rule: SuggestionRule | undefined): string | undefined =>
  rule && 'kind' in rule ? rule.kind : undefined;

suite('APT engine suggestions', () => {
  test('a parameter and a surface key are matched to the INI set they take', () => {
    assert.strictEqual(kindOf(findParameterSuggestion('SetPalantirFrameState', 'state')), 'sideState');
    assert.strictEqual(kindOf(findParameterSuggestion('SetFaction', 'bttnState')), 'side');
    assert.strictEqual(kindOf(findParameterSuggestion('SetPlayerFaction', 'faction')), 'side');
    assert.strictEqual(findParameterSuggestion('SetButtonState', 'state'), undefined);
    assert.strictEqual(kindOf(findImageSuggestion('RenderFactionIcon')), 'factionIcon');
    assert.strictEqual(kindOf(findImageSuggestion('TimeLine:PlayerFactionIcon:3')), 'factionIcon');
    assert.strictEqual(kindOf(findImageSuggestion('LoadScreen.UIClip.Level.4')), 'rankIcon');
    assert.strictEqual(findImageSuggestion('LoadScreen.UIClip.Fellowship.4'), undefined);
    assert.strictEqual(findImageSuggestion('MainMenu.Image'), undefined);
  });

  test('the surfaces of the create-a-hero, hero row and war of the ring screens find their sets', () => {
    const expected: [string, string][] = [
      ['MyPowerIcon_3', 'powerIcon'],
      ['SelectPower_2_4', 'powerIcon'],
      ['PalantirBttn_7', 'powerIcon'],
      ['Cah::ClassIcon2', 'classIcon'],
      ['Cah::TypeIcon1', 'typeIcon'],
      ['_level0_Hero4Image', 'heroImage'],
      ['CommandUI.Portrait', 'unitPortrait'],
      ['_level0_QueuedIconSlotPortrait2', 'unitPortrait'],
      ['StrategicVeterancy:UnitImage_3', 'unitPortrait'],
      ['InGameSpellBookSpell5Image', 'spellImage'],
      ['_level0.main.allies.4_PlayerIcon', 'factionIcon'],
      ['_level0.main.enemyTabs_Image2', 'factionIcon'],
      ['Stats:FactionIcon_1', 'factionIcon'],
      ['ButtonSet3_Image', 'buttonImage'],
    ];

    for (const [key, kind] of expected) {
      assert.strictEqual(kindOf(findImageSuggestion(key)), kind, key);
    }
    assert.strictEqual(findImageSuggestion('Cah::Portrait'), undefined);
    assert.strictEqual(findImageSuggestion('_level0_UnitIcon3'), undefined);
  });

  test('every rule names where its values come from', () => {
    const rules = [
      findParameterSuggestion('UpdateSelectPowerIcon', 'state'),
      findImageSuggestion('MyPowerIcon_1'),
      findExternSuggestion('TimeLine:ScreenMode'),
      findExternSuggestion('TimeLine:PlayerColor:2'),
      findBindingSuggestion('_AnimMode'),
    ];

    for (const rule of rules) {
      assert.ok(rule && rule.basis.length > 10);
    }
  });

  test('the states the engine passes are the sets mint binds', () => {
    assert.deepStrictEqual(fixedValues(findParameterSuggestion('UpdateSelectPowerIcon', 'state')), [
      '_unused',
      '_avail',
      '_needPrereq',
      '_levelLow',
      '_selected',
      '_palantirFull',
    ]);
    assert.deepStrictEqual(fixedValues(findParameterSuggestion('SetQueuedIconSlotState', 'state')), [
      '_empty',
      '_selected',
      '_up',
    ]);
    assert.deepStrictEqual(fixedValues(findParameterSuggestion('SetCommandPointsState', 'state')), [
      '_show',
      '_hide',
    ]);
    assert.strictEqual(findParameterSuggestion('SetState', 'state'), undefined);
  });

  test('externs the engine fixes offer their set, and colours the INI colours', () => {
    assert.deepStrictEqual(fixedValues(findExternSuggestion('TimeLine:ScreenMode')), [
      'OtherSingle',
      'OtherOnlineLan',
      'WOTRSingle',
      'WOTROnlineLan',
    ]);
    assert.deepStrictEqual(fixedValues(findExternSuggestion('SaveLoadMode')), ['Save', 'Load']);
    assert.deepStrictEqual(fixedValues(findExternSuggestion('InGame')), ['true', 'false']);
    assert.strictEqual(kindOf(findExternSuggestion('TimeLine:PlayerColor:3')), 'colourHex');
    assert.strictEqual(kindOf(findExternSuggestion('GameLoading:PlayerColor:0')), 'colourArgb');
    assert.strictEqual(findExternSuggestion('ScoreScreen:PlayerColor:0'), undefined);
    assert.strictEqual(findExternSuggestion('TimeLine:NumOfPlayers'), undefined);
  });

  test('the animation modes of a view are all the ones mint lists, those not played here said so', () => {
    const rule = findBindingSuggestion('_AnimMode');

    assert.deepStrictEqual(fixedValues(rule).slice(0, 3), ['MANUAL', 'LOOP', 'PLAY_TO_FRAME']);
    assert.strictEqual(fixedValues(rule).length, 7);
    assert.strictEqual(findBindingSuggestion('_RenderObj'), undefined);
  });

  test('sides come from the player templates, each once, with good or evil', async () => {
    assert.deepStrictEqual(await resolve('side'), [
      { value: 'Arnor', label: 'not playable' },
      { value: 'Men', label: 'good' },
      { value: 'Mordor', label: 'evil' },
    ]);
  });

  test('the palantir states name the playable sides they show', async () => {
    const options = await resolve('sideState');

    assert.deepStrictEqual(values(options), ['_good', '_evil', '_goodSingle', '_evilSingle']);
    assert.strictEqual(options[0].label, 'good sides: Men');
    assert.strictEqual(options[1].label, 'evil sides: Mordor');
  });

  test('picture kinds list the MappedImages that follow the engine naming', async () => {
    const sources = createSources(['AptIconMen', 'AptIconMordor', 'AptIconLarge2', 'AptRankIconElves3', 'AptRankIcon10', 'Other']);

    assert.deepStrictEqual(await resolve('factionIcon', sources), names(['AptIconMen', 'AptIconMordor']));
    assert.deepStrictEqual(await resolve('rankIcon', sources), names(['AptRankIcon10', 'AptRankIconElves3']));
  });

  test('button pictures are the ButtonImage values, each once whatever its casing', async () => {
    assert.deepStrictEqual(
      values(await resolve('buttonImage')),
      ['BTA', 'BTB', 'BTD', 'NoPower', 'PowerNone', 'PowerOne'],
    );
  });

  test('power pictures are the buttons with allowed upgrades, and the no-power button', async () => {
    assert.deepStrictEqual(values(await resolve('powerIcon')), ['NoPower', 'PowerOne']);
  });

  test('spell pictures are the buttons that name a science', async () => {
    assert.deepStrictEqual(await resolve('spellImage'), names(['BTB']));
  });

  test('colours are the MultiplayerColor swatches in the form each extern is written', async () => {
    assert.deepStrictEqual(await resolve('colourHex'), [
      { value: '0', label: 'ColorBlack (0, 0, 0)' },
      { value: '0x465b9c', label: 'ColorBlue (70, 91, 156)' },
    ]);
    assert.deepStrictEqual(values(await resolve('colourArgb')), ['4278190080', '4282801052']);
  });

  test('portraits are the SelectPortrait values, each once, with the objects that use them', async () => {
    assert.deepStrictEqual(await resolve('unitPortrait'), [
      { value: 'PortraitAragorn', label: 'AragornBase, Grunt' },
      { value: 'PortraitCamo', label: 'AragornCamo' },
    ]);
  });

  test('hero pictures are the ButtonImage of objects that are heroes once their parents are composed', async () => {
    const sources = createSources();

    assert.deepStrictEqual(await resolve('heroImage', sources), [
      { value: 'HeroAragorn', label: 'AragornBase' },
      { value: 'HeroEdited', label: 'HeroEdited' },
      { value: 'HeroElessar', label: 'AragornElessar' },
    ]);
    // Only a child that leaves its kind or its picture to a parent is composed
    assert.deepStrictEqual(sources.composedNames.sort(), ['AragornElessar', 'GruntElite', 'HeroEdited']);
  });

  test('class and type pictures follow the create-a-hero system in its order', async () => {
    const system: HeroSystem = {
      binders: [],
      blings: [],
      classes: [
        { iconImage: 'ClassOne', nameTag: 'CAH:One', subclasses: [{ iconImage: 'TypeOne', colors: [], blingUpgrades: [], attributes: [] }, { colors: [], blingUpgrades: [], attributes: [] }] },
        { subclasses: [{ iconImage: 'TypeTwo', nameTag: 'CAH:Two', colors: [], blingUpgrades: [], attributes: [] }] },
      ],
    };
    const sources = createSources([], undefined, system);

    assert.deepStrictEqual(await resolve('classIcon', sources), [{ value: 'ClassOne', label: 'class 0: CAH:One' }]);
    assert.deepStrictEqual(await resolve('typeIcon', sources), [
      { value: 'TypeOne', label: 'class 0 type 0' },
      { value: 'TypeTwo', label: 'class 1 type 0: CAH:Two' },
    ]);
  });

  test('with no game loaded every kind answers nothing', async () => {
    const empty = createSources([], []);

    for (const kind of ['side', 'sideState', 'factionIcon', 'rankIcon', 'buttonImage', 'powerIcon', 'spellImage', 'classIcon', 'typeIcon', 'heroImage', 'unitPortrait', 'colourHex', 'colourArgb'] as const) {
      assert.deepStrictEqual(await resolve(kind, empty), [], kind);
    }
  });

  test('a file that cannot be read leaves its records out', async () => {
    const failing = {
      ...createSources(),
      read: async () => {
        throw new Error('gone');
      },
    };

    assert.deepStrictEqual(await resolve('side', failing), []);
    assert.deepStrictEqual(await resolve('heroImage', failing), []);
  });

  test('a page cannot be sent more than the cap', async () => {
    const letters = (n: number): string =>
      n < 26
        ? String.fromCharCode(97 + n)
        : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));
    const many = Array.from(
      { length: MAX_OPTIONS + 10 },
      (_, i) => `AptIcon${letters(i)}`,
    );
    const options = await resolve('factionIcon', createSources(many));

    assert.strictEqual(options.length, MAX_OPTIONS);
  });
});
