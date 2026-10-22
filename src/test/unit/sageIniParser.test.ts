import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import type { SageIniSchema } from '../../language/model/sageIniSchema';
import {
  parseSageIni,
  stripComment,
  tokenize,
} from '../../language/model/sageIniParser';
import type { SageBlock } from '../../language/model/sageIniParser';

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
    assert.strictEqual(stripComment('Armor = PIERCE 25% //archer'), 'Armor = PIERCE 25% ');
    assert.strictEqual(stripComment('SinkDistance = 9;'), 'SinkDistance = 9');
    // A ; comment whose content holds //, which is how the file banners read
    assert.strictEqual(stripComment('; FILE: GameData.ini ////'), '');
    assert.strictEqual(stripComment('Model = GUArcher_SKN'), 'Model = GUArcher_SKN');
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
  test('the same keyword classifies differently by context', () => {
    assert.strictEqual(schema.classify('<root>', 'Armor'), 'block');
    assert.strictEqual(schema.classify('Armor', 'Armor'), 'field');
    assert.strictEqual(schema.classify('ArmorSet', 'Armor'), 'field');
    assert.strictEqual(schema.classify('<root>', 'Weapon'), 'block');
    assert.strictEqual(schema.classify('WeaponSet', 'Weapon'), 'field');
  });

  test('a module context keys on the module type, not the slot', () => {
    assert.ok(schema.isModuleSlot('Behavior'));
    assert.ok(schema.isModuleSlot('draw'));
    assert.ok(!schema.isModuleSlot('KindOf'));
    assert.strictEqual(
      schema.childContext('Behavior', 'SlowDeathBehavior'),
      'Behavior:SlowDeathBehavior',
    );
    assert.strictEqual(
      schema.classify('Behavior:SlowDeathBehavior', 'DestructionDelay'),
      'field',
    );
    // A keyword the module does not hold falls back to the slot
    assert.strictEqual(schema.classify('Behavior:SlowDeathBehavior', 'nope'), undefined);
  });

  test('an unknown keyword is reported as unknown, never as a field', () => {
    assert.strictEqual(schema.classify('Object', 'NotAFieldEA_EverUsed'), undefined);
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
    assert.strictEqual(object.children[0].context, 'Body:ActiveBody');
  });

  test('End closes a block in any casing', () => {
    const [object] = parse(['Object A', '    Body = ActiveBody T', '    END', 'end'].join('\n'));

    assert.strictEqual(object.endLine, 3);
    assert.strictEqual(object.children[0].endLine, 2);
  });

  test('a trailing comment does not change the header arity', () => {
    const [object] = parse('Object CINE_SauronEye ;A great eye, lidless\nEnd');

    assert.strictEqual(object.name, 'CINE_SauronEye');
  });

  test('an unknown keyword falls back to looking for its End', () => {
    const [withEnd] = parse(['Object A', '    Wibble', '        Foo = 1', '    End', 'End'].join('\n'));
    assert.strictEqual(withEnd.children.length, 1, 'a matching End opens a block');

    const [withoutEnd] = parse(['Object A', '    Wibble = OCL_Rock', 'End'].join('\n'));
    assert.strictEqual(withoutEnd.children.length, 0, 'no End keeps it a leaf');
  });

  test('an .inc fragment parses without inventing errors', () => {
    // Fragments open mid-block and carry an End that closes their includer
    const blocks = parse(
      [
        '    Behavior = FXListDie ModuleTag_AnnounceWeLostTheRing',
        '        DeathFX = AnnounceFortressDeathLostRingFX',
        '    End',
        'End',
      ].join('\n'),
    );

    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].moduleType, 'FXListDie');
    assert.strictEqual(blocks[0].endLine, 2);
  });

  test('an unclosed block ends with the file rather than being dropped', () => {
    const [object] = parse('Object A\n    Body = ActiveBody T\n        MaxHealth = 1');

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

    // Transition is a slot, so its type decides the fields below it
    const [window] = transition.children;
    assert.strictEqual(window.keyword, 'Window');
    assert.strictEqual(window.children[0].context, 'Transition:SOUNDFADE');
    assert.strictEqual(
      schema.classify('Transition:SOUNDFADE', 'StartFrame'),
      'field',
    );
  });

  test('Color as a value is a field, while Color as a slot opens a block', () => {
    // The same keyword, told apart only by where it sits
    assert.strictEqual(schema.classify('DefaultColor', 'Color'), undefined);
    assert.ok(schema.isModuleSlot('Color'));

    const [system] = parse(
      ['FXParticleSystem P', '  Color = DefaultColor', '  End', 'End'].join('\n'),
    );

    assert.strictEqual(system.children[0].moduleType, 'DefaultColor');
  });
});
