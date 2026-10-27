import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import { referencedNames } from '../../language/model/sageAudioValues';
import { resolveSageSymbol } from '../../language/model/sageIniSymbol';
import {
  collectEntries,
  reachedThroughMacros,
} from '../../language/model/sageIniEntries';
import type {
  EntryBodyToken,
  FileEntries,
} from '../../language/model/sageIniEntries';
import {
  evaluateCall,
  scanCalls,
} from '../../language/model/sageIniPreprocessor';
import {
  findUnresolvedReferences,
  isNotAName,
} from '../../language/model/sageIniReferenceCheck';
import { canonicalNamespace } from '../../language/model/sageReferenceFields';
import { decodeIniText } from '../../common/windows1252';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

const parse = (lines: string[], isFragment = false) =>
  parseSageIni(lines, schema, { isFragment });

/** Every name the statements of a fixture reference, as `name@Namespace` */
const referenced = (lines: string[]): string[] =>
  parse(lines).statements.flatMap((statement) =>
    referencedNames(statement, schema).flatMap((reference) =>
      reference.namespaces.map((namespace) => `${reference.name}@${namespace}`),
    ),
  );

/** A workspace index built in code from invented files */
const workspaceOf = (files: Record<string, string[]>) => {
  const all = Object.entries(files).map(
    ([path, lines]): [string, FileEntries] => [
      path,
      collectEntries(lines.join('\n'), path, schema),
    ],
  );
  const definitions = new Map<string, Set<string>>();
  const macros = new Set<string>();
  const bodyTokens = new Map<string, EntryBodyToken[]>();

  for (const [, entries] of all) {
    entries.definitions.forEach(({ namespace, name }) => {
      const names = definitions.get(namespace.toLowerCase()) ?? new Set();

      names.add(name.toLowerCase());
      definitions.set(namespace.toLowerCase(), names);
    });
    entries.macros.forEach((macro) => macros.add(macro.name.toLowerCase()));
    entries.bodyTokens.forEach((token) =>
      bodyTokens.set(token.text, [...(bodyTokens.get(token.text) ?? []), token]),
    );
  }

  return {
    all: new Map(all),
    bodyTokens,
    lookup: {
      findMacro: (name: string) => macros.has(name.toLowerCase()),
      findDefinitions: (namespace: string, name: string) =>
        definitions
          .get(canonicalNamespace(namespace).toLowerCase())
          ?.has(name.toLowerCase())
          ? [1]
          : [],
      countDefinitions: (namespace: string) =>
        definitions.get(canonicalNamespace(namespace).toLowerCase())?.size ??
        0,
    },
  };
};

const warningsIn = (
  files: Record<string, string[]>,
  path: string,
): string[] => {
  const { lookup } = workspaceOf(files);

  return findUnresolvedReferences(
    parse(files[path]),
    schema,
    lookup,
    true,
  ).map(({ name }) => name);
};

const MOD = {
  'weapons.ini': ['Weapon MyWeapon', 'End'],
  'objects.ini': [
    'Object Base',
    '  WeaponSet',
    '    Conditions = None',
    '    Weapon = PRIMARY MyWeapon',
    '  End',
    'End',
    'ChildObject Kid Base',
    'End',
    'ObjectReskin Skin Kid',
    'End',
  ],
  'buttons.ini': [
    'CommandButton ButtonOne',
    '  Command = SPECIAL_POWER',
    '  Object = Skin',
    '  RadiusCursorType = Cursor',
    'End',
    'CommandButton ButtonTwo',
    '  Object = Kid',
    'End',
  ],
  'ingameui.ini': [
    'InGameUI',
    '  RadiusCursorTemplate = Cursor',
    '    Texture = cursor_tex',
    '  End',
    'End',
  ],
  'campaign.ini': [
    'LivingWorldRegionCampaign Campaign',
    '  Region RegionOne',
    '    Connection',
    '      Region = RegionTwo',
    '    End',
    '  End',
    '  Region RegionTwo',
    '  End',
    'End',
  ],
  'macros.ini': [
    '#define LEVEL_0 7',
    ...Array.from(
      { length: 10 },
      (_, level) => `#define LEVEL_${level + 1} #ADD( LEVEL_${level} 1 )`,
    ),
    '#define STARTING__UNIT Base',
    '#define ALIAS_UNIT STARTING__UNIT',
    'CommandButton ButtonThree',
    '  Object = ALIAS_UNIT',
    '  Weapon = PRIMARY LEVEL_10',
    'End',
  ],
};

suite('SAGE INI reference checking', () => {
  test('Object, ChildObject and ObjectReskin are one namespace', () => {
    const { all, lookup } = workspaceOf(MOD);
    const defined = all
      .get('objects.ini')!
      .definitions.map(({ namespace, name }) => `${name}@${namespace}`);

    assert.deepStrictEqual(defined, [
      'Base@Object',
      'Kid@Object',
      'Skin@Object',
    ]);
    assert.strictEqual(lookup.findDefinitions('ChildObject', 'Kid').length, 1);
    assert.strictEqual(lookup.countDefinitions('Object'), 3);
  });

  test('a ChildObject or ObjectReskin header references its parent as an Object', () => {
    assert.deepStrictEqual(
      referenced(['ChildObject Kid Base', 'End', 'ObjectReskin S Kid', 'End']),
      ['Base@Object', 'Kid@Object'],
    );

    const lines = ['ChildObject Kid Base', 'End'];
    const symbol = (character: number) =>
      resolveSageSymbol(parse(lines), schema, 0, character);

    assert.deepStrictEqual(
      [symbol(15)?.name, symbol(15)?.isDeclaration, symbol(15)?.namespaces],
      ['Kid', true, ['Object']],
    );
    assert.deepStrictEqual(
      [symbol(20)?.name, symbol(20)?.isDeclaration, symbol(20)?.namespaces],
      ['Base', false, ['Object']],
    );
  });

  test('a reference to a ChildObject or ObjectReskin is not reported', () => {
    assert.deepStrictEqual(warningsIn(MOD, 'buttons.ini'), []);
  });

  test('macro bodies are read: constants, spellings, and 10-deep chains', () => {
    const { all, bodyTokens } = workspaceOf(MOD);
    const entries = all.get('macros.ini')!;

    assert.ok(
      entries.constantUses.some(
        ({ key, field }) =>
          key === 'level_5' && field === '#define LEVEL_6',
      ),
    );
    assert.ok(
      entries.constantUses.some(({ key }) => key === 'starting__unit'),
    );

    const body = entries.bodyTokens.find(
      ({ macro, text }) => macro === 'alias_unit' && text === 'starting__unit',
    );

    assert.ok(body);
    assert.strictEqual(
      'ALIAS_UNIT'.length + '#define ALIAS_UNIT '.length - 'ALIAS_UNIT'.length,
      body.start,
    );
    assert.ok(bodyTokens.has('starting__unit'));
  });

  test('a name written through a macro chain is followed into the bodies', () => {
    const { all, bodyTokens } = workspaceOf(MOD);
    const written = new Set(
      all
        .get('macros.ini')!
        .references.filter(({ namespace }) => namespace === 'Object')
        .map(({ name }) => name.toLowerCase()),
    );
    const reached = reachedThroughMacros(
      bodyTokens.get('base') ?? [],
      bodyTokens,
      (macro) => written.has(macro),
    );

    // `Base` is spelt in STARTING__UNIT, which ALIAS_UNIT holds, which the
    // field writes; `LEVEL_*` holds no name
    assert.deepStrictEqual(
      reached.map(({ macro }) => macro),
      ['starting__unit'],
    );
    assert.deepStrictEqual(
      reachedThroughMacros(
        bodyTokens.get('level_0') ?? [],
        bodyTokens,
        (macro) => written.has(macro),
      ),
      [],
    );
  });

  test('a macro chain ten deep evaluates; a real cycle is caught', () => {
    const macros: Record<string, string> = {
      level_0: '7',
      loop_a: '#ADD( LOOP_B 1 )',
      loop_b: '#ADD( LOOP_A 1 )',
      alias_a: 'ALIAS_B',
      alias_b: 'LEVEL_10',
    };

    for (let level = 1; level <= 10; level += 1) {
      macros[`level_${level}`] = `#ADD( LEVEL_${level - 1} 1 )`;
    }

    const lookup = (name: string) => macros[name.toLowerCase()];
    const evaluate = (line: string) =>
      evaluateCall(scanCalls(line, 0)[0], lookup);

    assert.deepStrictEqual(evaluate('#ADD( LEVEL_10 0 )'), { value: 17 });
    assert.deepStrictEqual(evaluate('#ADD( ALIAS_A 0 )'), { value: 17 });
    assert.match(
      (evaluate('#ADD( LOOP_A 0 )') as { error: string }).error,
      /refers to itself/,
    );
  });

  test('fields are keyed by block, not by name alone', () => {
    assert.deepStrictEqual(
      referenced([
        'MouseCursor Cur',
        '  Image = cursor_image',
        'End',
        'AutoResolveArmor Auto',
        '  Armor = HumanArmor',
        'End',
        'CommandButton Btn',
        '  ButtonImage = ButtonPic',
        'End',
      ]),
      ['ButtonPic@MappedImage'],
    );
  });

  test('flags are not references', () => {
    assert.deepStrictEqual(
      referenced([
        'Object Unit',
        '  ShadowOverrideLODVisibility = HighDetailOnly',
        '  Draw = W3DModelDraw ModuleTag_Draw',
        '    ModelConditionState = DAMAGED',
        '    End',
        '  End',
        'End',
        'CommandButton Btn',
        '  EnableOnModelCondition = DAMAGED',
        '  AutoAbilityDisallowedOnModelCondition = DAMAGED',
        'End',
      ]),
      [],
    );
  });

  test('only the second token of ParticleSysBone names a particle system', () => {
    const lines = [
      'FXList Boom',
      '  ParticleSystem',
      '    Name = Spark',
      '  End',
      'End',
      'Object Unit',
      '  Draw = W3DModelDraw ModuleTag_Draw',
      '    ParticleSysBone = BoneName FireSystem',
      '  End',
      'End',
    ];

    assert.deepStrictEqual(
      referenced(lines).filter((name) => name.endsWith('ParticleSystem')),
      ['Spark@FXParticleSystem', 'Spark@ParticleSystem', 'FireSystem@FXParticleSystem'],
    );

    const bone = resolveSageSymbol(parse(lines), schema, 7, 24);
    const system = resolveSageSymbol(parse(lines), schema, 7, 35);

    assert.deepStrictEqual(bone?.namespaces, []);
    assert.deepStrictEqual(system?.namespaces, ['FXParticleSystem']);
  });

  test('Filename of a Video or AmbientStream is a file, not a reference', () => {
    assert.deepStrictEqual(
      referenced([
        'Video Intro',
        '  Filename = intro_movie',
        'End',
        'AmbientStream Wind',
        '  Filename = wind_loop.wav',
        'End',
      ]),
      [],
    );
  });

  test('a Region inside a campaign and a RadiusCursorTemplate inside InGameUI are definitions', () => {
    const { all, lookup } = workspaceOf(MOD);

    assert.deepStrictEqual(
      all
        .get('campaign.ini')!
        .definitions.filter(({ namespace }) => namespace === 'Region')
        .map(({ name }) => name),
      ['RegionOne', 'RegionTwo'],
    );
    assert.strictEqual(lookup.findDefinitions('Region', 'RegionTwo').length, 1);
    assert.strictEqual(
      lookup.findDefinitions('RadiusCursorTemplate', 'Cursor').length,
      1,
    );
    assert.deepStrictEqual(warningsIn(MOD, 'campaign.ini'), []);
  });

  test('a Region in an .inc fragment is a definition too', () => {
    const entries = collectEntries(
      ['Region FragmentRegion', 'End'].join('\n'),
      'regions.inc',
      schema,
    );

    assert.deepStrictEqual(
      entries.definitions.map(({ namespace }) => namespace),
      ['Region'],
    );
  });

  test('only capitals with underscores are skipped as names', () => {
    assert.ok(isNotAName('HUMAN_ARMOR'));
    assert.ok(isNotAName('FOO__BAR'));
    assert.ok(isNotAName('PRIMARY'));
    assert.ok(isNotAName('75%'));
    assert.ok(isNotAName('None'));
    assert.ok(isNotAName('NONE'));
    assert.ok(isNotAName('Sound:Name'));
    assert.ok(!isNotAName('HumanArmor'));
    assert.ok(!isNotAName('Weapon_Sword'));
    assert.ok(!isNotAName('mymisspelledweapon'));
  });

  test('a valid mod has no reference warnings; a misspelt Weapon is flagged', () => {
    for (const path of Object.keys(MOD)) {
      assert.deepStrictEqual(warningsIn(MOD, path), [], path);
    }

    const misspelt = {
      ...MOD,
      'objects.ini': MOD['objects.ini'].map((line) =>
        line.replace('MyWeapon', 'MyWeapn'),
      ),
    };

    assert.deepStrictEqual(warningsIn(misspelt, 'objects.ini'), ['MyWeapn']);
  });

  test('a misspelt parent of a ChildObject is flagged', () => {
    const files = { ...MOD, 'bad.ini': ['ChildObject Bad Basee', 'End'] };

    assert.deepStrictEqual(warningsIn(files, 'bad.ini'), ['Basee']);
  });

  test('a byte order mark is not part of the first line', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('Weapon W')]);

    assert.strictEqual(decodeIniText(bytes), 'Weapon W');
    assert.strictEqual(
      decodeIniText(Uint8Array.from(Buffer.from('Weapon W'))),
      'Weapon W',
    );
  });
});
