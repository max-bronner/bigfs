import { AUDIO_NAMESPACES } from '../../game/audio/sageAudioFields';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FRAGMENT_CONTEXT,
  ROOT_CONTEXT,
  UNCHECKED_CONTEXT,
  createSageIniSchema,
} from '../../formats/ini/sageIniSchema';
import type { SageIniSchema } from '../../formats/ini/sageIniSchema';
import {
  parseSageIni,
  stripComment,
  tokenize,
} from '../../formats/ini/sageIniParser';
import type { SageBlock } from '../../formats/ini/sageIniParser';

/**
 * The schema ships as data, so the tests read the same file the extension
 * does rather than a fixture that could drift from it.
 */
const schema: SageIniSchema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

const parse = (source: string): SageBlock[] =>
  parseSageIni(source.split('\n'), schema).blocks;

suite('SAGE INI lexing', () => {
  test('stripComment takes whichever marker opens first', () => {
    assert.strictEqual(
      stripComment('Armor = PIERCE 25% //archer'),
      'Armor = PIERCE 25% ',
    );
    assert.strictEqual(stripComment('SinkDistance = 9;'), 'SinkDistance = 9');
    // A ; comment whose content holds //, which is how the file banners read
    assert.strictEqual(stripComment('; FILE: GameData.ini ////'), '');
    assert.strictEqual(
      stripComment('Model = GUArcher_SKN'),
      'Model = GUArcher_SKN',
    );
  });

  test('tokenize reads a quoted value with spaces as one token', () => {
    const [, value, next] = tokenize('Map = "AI BASE - MORDOR" Extra');

    assert.deepStrictEqual(value, {
      text: 'AI BASE - MORDOR',
      start: 7,
      end: 23,
    });
    assert.strictEqual(next.text, 'Extra');
    // Unterminated, the quote runs to the end of the line
    assert.strictEqual(
      tokenize('DisplayName = "OBJECT:Name')[1].text,
      'OBJECT:Name',
    );
  });

  test('tokenize treats = as whitespace and keeps token columns', () => {
    assert.deepStrictEqual(
      tokenize('Behavior = LifetimeUpdate ModuleTag_01').map((t) => t.text),
      ['Behavior', 'LifetimeUpdate', 'ModuleTag_01'],
    );
    assert.deepStrictEqual(
      tokenize('ParticleSysBone NONE GoldChestGlimmer').map((t) => t.text),
      ['ParticleSysBone', 'NONE', 'GoldChestGlimmer'],
    );
    // Columns index into the original line, so a provider can build a range
    assert.deepStrictEqual(tokenize('  Armor = DEFAULT')[1], {
      text: 'DEFAULT',
      start: 10,
      end: 17,
    });
  });
});

suite('SAGE INI schema', () => {
  /** The context a keyword's block opens, which must exist */
  const childOf = (context: string, keyword: string, values: string[] = []) => {
    const resolution = schema.resolve(context, keyword, values);

    assert.strictEqual(resolution?.kind, 'block', `${keyword} opens no block`);

    return resolution.childContext!;
  };

  test('the same keyword resolves differently by context', () => {
    const armor = childOf(ROOT_CONTEXT, 'Armor');
    const object = childOf(ROOT_CONTEXT, 'Object');

    assert.strictEqual(schema.resolve(armor, 'Armor', [])?.kind, 'field');
    assert.strictEqual(
      schema.resolve(childOf(object, 'ArmorSet'), 'Armor', [])?.kind,
      'field',
    );
    assert.strictEqual(schema.resolve(ROOT_CONTEXT, 'KindOf', []), undefined);
  });

  test('a module slot looks its lines up in the module its value names', () => {
    const object = childOf(ROOT_CONTEXT, 'Object');
    const resolution = schema.resolve(object, 'Behavior', [
      'SlowDeathBehavior',
      'ModuleTag_Death',
    ]);

    assert.ok(schema.isModuleSlot('Behavior'));
    assert.ok(!schema.isModuleSlot('KindOf'));
    assert.strictEqual(resolution?.moduleType, 'SlowDeathBehavior');
    assert.strictEqual(
      schema.resolve(resolution.childContext!, 'DestructionDelay', [])?.kind,
      'field',
    );
    assert.strictEqual(
      schema.resolve(resolution.childContext!, 'NotAFieldEA_EverUsed', []),
      undefined,
    );
  });

  test('a module the grammar does not know leaves its lines unchecked', () => {
    const object = childOf(ROOT_CONTEXT, 'Object');
    const context = childOf(object, 'Behavior', ['NotAModule', 'Tag']);

    assert.strictEqual(context, UNCHECKED_CONTEXT);
    assert.ok(!schema.isChecked(context));
  });

  test('an .inc fragment may open with a keyword of any context', () => {
    assert.strictEqual(
      schema.resolve(FRAGMENT_CONTEXT, 'Behavior', ['SlowDeathBehavior'])?.kind,
      'block',
    );
    assert.strictEqual(
      schema.resolve(FRAGMENT_CONTEXT, 'KindOf', [])?.kind,
      'field',
    );
    assert.strictEqual(
      schema.resolve(FRAGMENT_CONTEXT, 'NotAFieldEA_EverUsed', []),
      undefined,
    );
  });

  test('a name only one game reads is refused for the other', () => {
    const data = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
        'utf8',
      ),
    );
    const bfme2 = createSageIniSchema(data, 'bfme2');
    const id = data.contexts.findIndex((context: { f: [string, number][] }) =>
      context.f.some(([, mask]) => mask === 2),
    );
    const [name] = data.contexts[id].f.find(
      ([, mask]: [string, number]) => mask === 2,
    );

    assert.strictEqual(schema.resolve(String(id), name, [])?.kind, 'field');
    assert.strictEqual(bfme2.resolve(String(id), name, []), undefined);
  });
});

suite('SAGE INI parsing', () => {
  test('a block header and a leaf field of the same shape are told apart', () => {
    const [object] = parse(
      [
        'Object GondorArcher',
        '    Body = ActiveBody ModuleTag_02',
        '        MaxHealth = 100',
        '    End',
        '    Armor = DEFAULT 100%',
        '    KindOf = SELECTABLE INFANTRY',
        'End',
      ].join('\n'),
    );

    assert.strictEqual(object.name, 'GondorArcher');
    assert.strictEqual(object.endLine, 6);
    // Body opens a block; Armor and KindOf are leaves despite the same shape
    assert.strictEqual(object.children.length, 1);
    assert.strictEqual(object.children[0].moduleType, 'ActiveBody');
    assert.strictEqual(object.children[0].moduleTag, 'ModuleTag_02');
    assert.strictEqual(
      schema.describeContext(object.children[0].context),
      'ActiveBody',
    );
  });

  test('End closes a block in any casing', () => {
    const [object] = parse(
      ['Object A', '    Body = ActiveBody T', '    END', 'end'].join('\n'),
    );

    assert.strictEqual(object.endLine, 3);
    assert.strictEqual(object.children[0].endLine, 2);
  });

  test('a trailing comment does not change the header arity', () => {
    const [object] = parse('Object CINE_SauronEye ;A great eye, lidless\nEnd');

    assert.strictEqual(object.name, 'CINE_SauronEye');
  });

  test('an unknown keyword falls back to looking for its End', () => {
    const [withEnd] = parse(
      ['Object A', '    Wibble', '        Foo = 1', '    End', 'End'].join(
        '\n',
      ),
    );
    assert.strictEqual(
      withEnd.children.length,
      1,
      'a matching End opens a block',
    );

    const [withoutEnd] = parse(
      ['Object A', '    Wibble = OCL_Rock', 'End'].join('\n'),
    );
    assert.strictEqual(withoutEnd.children.length, 0, 'no End keeps it a leaf');
  });

  test('an .inc fragment parses without inventing errors', () => {
    // Fragments open mid-block and carry an End that closes their includer
    const { blocks, strayEnds, statements } = parseSageIni(
      [
        '    Behavior = FXListDie ModuleTag_AnnounceWeLostTheRing',
        '        DeathFX = AnnounceFortressDeathLostRingFX',
        '    End',
        'End',
      ],
      schema,
      { isFragment: true },
    );

    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(strayEnds, [3]);
    assert.ok(statements.every((statement) => statement.isKnown));
    assert.strictEqual(blocks[0].moduleType, 'FXListDie');
    assert.strictEqual(blocks[0].endLine, 2);
  });

  test('an unclosed block ends with the file rather than being dropped', () => {
    const [object] = parse(
      'Object A\n    Body = ActiveBody T\n        MaxHealth = 1',
    );

    assert.strictEqual(object.endLine, 2);
    assert.strictEqual(object.children[0].endLine, 2);
  });

  test('an embedded script is recorded and its contents are not parsed', () => {
    const { blocks, scripts } = parseSageIni(
      [
        'Object A',
        '    BeginScript',
        '        Object = "not a block"',
        '        End',
        '    EndScript',
        'End',
      ],
      schema,
    );

    assert.deepStrictEqual(scripts, [{ startLine: 1, endLine: 4 }]);
    // The End inside the script must not close the Object
    assert.strictEqual(blocks[0].endLine, 5);
    assert.strictEqual(blocks[0].children.length, 0);
  });

  test('a script marker followed by a comment still opens and closes it', () => {
    const { blocks, scripts } = parseSageIni(
      [
        'Object A',
        '    BeginScript ; set the state',
        '        End',
        '    EndScript // done',
        'End',
      ],
      schema,
    );

    assert.deepStrictEqual(scripts, [{ startLine: 1, endLine: 3 }]);
    assert.strictEqual(blocks[0].endLine, 4);
  });

  test('AddEmotion = OVERRIDE opens an inline block, a plain AddEmotion does not', () => {
    const blocks = parse(
      [
        'EmotionNugget Fear',
        '    AddEmotion = OVERRIDE Terror',
        '        Duration = 1000',
        '    End',
        '    AddEmotion = Panic',
        'End',
        'EmotionNugget Calm',
        'End',
      ].join('\n'),
    );

    assert.deepStrictEqual(
      blocks.map((block) => block.name),
      ['Fear', 'Calm'],
    );
    assert.deepStrictEqual(
      blocks[0].children.map((child) => [child.name, child.endLine]),
      [['OVERRIDE Terror', 3]],
    );
  });
});

suite('SAGE INI engine data', () => {
  test('a root block the engine dispatches on is marked as engine defined', () => {
    // WindowTransition is a real root block, not the Wind slot plus a suffix
    assert.ok(schema.isEngineBlock('WindowTransition'));
    assert.ok(schema.isEngineBlock('Object'));
    assert.ok(!schema.isEngineBlock('NotABlockTheEngineKnows'));
  });

  test('a field carries the engine type that decides how its value reads', () => {
    // Coord3D and Color are why X:0 Y:0 Z:5 and R:255 G:255 are not sub-keys
    assert.strictEqual(schema.getEngineField('Offset')?.type, 'Coord3D');
    assert.strictEqual(schema.getEngineField('Color')?.type, 'Color');
    assert.strictEqual(schema.getEngineField('MaxHealth')?.type, 'Real');
    assert.strictEqual(schema.getEngineField('WinName')?.type, 'AssetPath');
    assert.strictEqual(schema.getEngineField('NotAnEngineField'), undefined);
  });

  test('a reference field names the namespace its value resolves into', () => {
    assert.deepStrictEqual(schema.getReferenceNamespaces('CommandSet'), [
      'CommandSet',
    ]);
    assert.ok(schema.getReferenceNamespaces('DeathFX').includes('FXList'));
    // Armor = DEFAULT 100% is a damage multiplier, so it resolves nowhere
    assert.deepStrictEqual(schema.getReferenceNamespaces('MaxHealth'), []);

    // `Name` names what an FX list nugget plays, by the nugget it is in
    const nugget = (slot: string) =>
      parseSageIni(
        ['FXList FX_Test', `  ${slot}`, '    Name = Something', '  End', 'End'],
        schema,
      ).statements.find((statement) => statement.keyword.text === 'Name')!;

    assert.deepStrictEqual(
      schema.getReferenceNamespaces('Name', nugget('ParticleSystem').context),
      ['FXParticleSystem', 'ParticleSystem'],
    );
    assert.deepStrictEqual(
      schema.getReferenceNamespaces('Name', nugget('Sound').context),
      [...AUDIO_NAMESPACES],
    );
    assert.deepStrictEqual(schema.getReferenceNamespaces('Name'), []);
  });
});

suite('SAGE INI slots that a grammar gets wrong', () => {
  test('WindowTransition is a root block, not the Wind slot', () => {
    const [transition] = parse(
      [
        'WindowTransition MainMenuFade',
        '  Window',
        '    Transition = SOUNDFADE',
        '      StartFrame = 0',
        '    End',
        '    FrameDelay = 0',
        '  End',
        'End',
      ].join('\n'),
    );

    assert.strictEqual(transition.keyword, 'WindowTransition');
    assert.strictEqual(transition.name, 'MainMenuFade');
    assert.strictEqual(transition.moduleType, undefined);

    // Transition's first value picks the table its lines are read against
    const [window] = transition.children;
    assert.strictEqual(window.keyword, 'Window');
    assert.match(
      schema.describeContext(window.children[0].context),
      /Transition SOUNDFADE$/,
    );
  });

  test('Color opens a block inside a particle system and nowhere at file scope', () => {
    assert.strictEqual(schema.resolve(ROOT_CONTEXT, 'Color', []), undefined);

    const [system] = parse(
      ['FXParticleSystem P', '  Color = DefaultColor', '  End', 'End'].join(
        '\n',
      ),
    );

    assert.strictEqual(system.children[0].keyword, 'Color');
    assert.strictEqual(system.endLine, 3);
  });
});
