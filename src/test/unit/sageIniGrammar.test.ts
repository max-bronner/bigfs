import * as assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  FRAGMENT_CONTEXT,
  ROOT_CONTEXT,
  UNCHECKED_CONTEXT,
  createSageIniSchema,
} from '../../formats/ini/sageIniSchema';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { findSageIniProblems } from '../../formats/ini/sageIniProblems';
import { formatSageIni } from '../../formats/ini/sageIniFormat';

/**
 * Grammar fixtures are synthetic text written here, in the shapes the shipped
 * INI uses; no line of game data is copied. The expectations are the engine's
 * own readings (mint's table.rs, docs/research/ini-bfme-delta.md).
 */
const data = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
    'utf8',
  ),
);
const schema = createSageIniSchema(data);

const problemsOf = (lines: string[], isFragment = false): string[] =>
  findSageIniProblems(parseSageIni(lines, schema, { isFragment }), schema).map(
    ({ line, message }) => `${line}: ${message}`,
  );

suite('SAGE INI grammar: emotions', () => {
  test('a plain AddEmotion is a field, so the next Behavior is a sibling', () => {
    const lines = [
      'Object A',
      '  Behavior = EmotionTrackerUpdate ModuleTag_E',
      '    AddEmotion = EMOTION_ONE',
      '    AddEmotion = EMOTION_TWO',
      '    AddEmotion = EMOTION_THREE',
      '  End',
      '  Behavior = SlowDeathBehavior ModuleTag_S',
      '  End',
      'End',
    ];
    const { blocks, strayEnds } = parseSageIni(lines, schema);

    assert.deepStrictEqual(problemsOf(lines), []);
    assert.deepStrictEqual(strayEnds, []);
    assert.strictEqual(blocks[0].children.length, 2);
    assert.strictEqual(blocks[0].children[0].children.length, 0);
  });

  test('AddEmotion = OVERRIDE defines an emotion and opens a block', () => {
    const lines = [
      'Object A',
      '  Behavior = EmotionTrackerUpdate ModuleTag_E',
      '    AddEmotion = OVERRIDE EMOTION_ONE',
      '      Anything = 1',
      '    End',
      '    AddEmotion = EMOTION_TWO',
      '  End',
      'End',
    ];
    const [object] = parseSageIni(lines, schema).blocks;

    assert.deepStrictEqual(problemsOf(lines), []);
    assert.strictEqual(object.children[0].children.length, 1);
    assert.strictEqual(object.children[0].children[0].endLine, 4);
  });
});

suite('SAGE INI grammar: End', () => {
  test('End followed by tokens closes the block', () => {
    const lines = [
      'Object A',
      '  Body = ActiveBody ModuleTag_B',
      '    MaxHealth = 100',
      '  End  StateName = Sword',
      'End',
    ];
    const { blocks, strayEnds } = parseSageIni(lines, schema);

    assert.deepStrictEqual(problemsOf(lines), []);
    assert.deepStrictEqual(strayEnds, []);
    assert.strictEqual(blocks[0].children[0].endLine, 3);
    assert.ok(blocks[0].children[0].isClosed);
  });

  test('the formatter indents a closing line that carries tokens', () => {
    const lines = ['Object A', 'Body = ActiveBody T', 'End  X = 1', 'End'];

    assert.deepStrictEqual(
      formatSageIni(lines, parseSageIni(lines, schema), '  '),
      ['Object A', '  Body = ActiveBody T', '  End  X = 1', 'End'],
    );
  });
});

suite('SAGE INI grammar: blocks from mint table.rs', () => {
  test('MeleeBehavior is a block inside the horde contain modules', () => {
    for (const module of [
      'HordeContain',
      'HorseHordeContain',
      'AODHordeContain',
    ]) {
      const lines = [
        'Object A',
        `  Behavior = ${module} ModuleTag_H`,
        '    ContainMax = 5',
        '    MeleeBehavior',
        '      InnerRange = 20',
        '    End',
        '    ObjectStatusOfContained =',
        '  End',
        'End',
      ];
      const [object] = parseSageIni(lines, schema).blocks;

      assert.deepStrictEqual(problemsOf(lines), [], module);
      assert.strictEqual(object.children[0].children.length, 1, module);
    }
  });

  test('StanceTemplate holds Stance blocks, which hold MeleeBehavior', () => {
    const lines = [
      'StanceTemplate Infantry',
      '  Stance = Aggressive',
      '    MeleeBehavior',
      '      InnerRange = 5',
      '    End',
      '  End',
      'End',
    ];
    const [template] = parseSageIni(lines, schema).blocks;

    assert.deepStrictEqual(problemsOf(lines), []);
    assert.strictEqual(template.children[0].keyword, 'Stance');
    assert.strictEqual(
      template.children[0].children[0].keyword,
      'MeleeBehavior',
    );
  });

  test('the one-line records at file scope are fields, with no End', () => {
    const lines = [
      'LODPreset = LOW 1 2',
      'BenchProfile = 1 2 3',
      'WebpageURL ShopLink',
      '  URL = x',
      'End',
      'OptionGroup Video',
      '  Anything = 1',
      'End',
      'StrategicHUD',
      '  OptionsButton',
      '    Anything = 1',
      '  End',
      'End',
      'LivingWorldRegionEffects',
      '  BordersEffect',
      '    ColorIntensityControlPoint',
      '      Anything = 1',
      '    End',
      '  End',
      'End',
    ];

    assert.deepStrictEqual(problemsOf(lines), []);
    assert.deepStrictEqual(parseSageIni(lines, schema).strayEnds, []);
  });

  test('FormationTemplate nests in FormationAssistant', () => {
    const lines = [
      'FormationAssistant',
      '  FormationTemplate Line',
      '    Rows',
      '      Anything = 1',
      '    End',
      '  End',
      'End',
    ];

    assert.deepStrictEqual(problemsOf(lines), []);
  });

  test('an unknown field in a known block still errors', () => {
    assert.deepStrictEqual(
      problemsOf([
        'Object A',
        '  Behavior = HordeContain ModuleTag_H',
        '    MeleeBehavior',
        '      InnerRang = 20',
        '    End',
        '    ContainMaxx = 5',
        '  End',
        'End',
      ]),
      [
        "3: 'InnerRang' is not a block or field Rise of the Witch-king reads in HordeContain > MeleeBehavior",
        "5: 'ContainMaxx' is not a block or field Rise of the Witch-king reads in HordeContain",
      ],
    );
  });

  test('a keyword at file scope that nothing registers still errors', () => {
    assert.deepStrictEqual(problemsOf(['Wibble = 1']), [
      "0: 'Wibble' is not a block or field Rise of the Witch-king reads at file scope",
    ]);
  });
});

suite('SAGE INI grammar: .inc fragments', () => {
  test('a Region fragment reads Connection, DetourPoint and the restrictions', () => {
    const lines = [
      '  Region Gondor',
      '    MapName = x',
      '    Connection',
      '      Region = Rohan',
      '      DetourPoint = X:1 Y:2',
      '      RestrictBuildings',
      '        Buildings = A B',
      '        NumberAllowed = 1',
      '      End',
      '    End',
      '    RestrictBuildings',
      '      Buildings = A',
      '      NumberAllowed = 2',
      '    End',
      '  End',
    ];
    const { blocks, strayEnds } = parseSageIni(lines, schema, {
      isFragment: true,
    });

    assert.deepStrictEqual(problemsOf(lines, true), []);
    assert.deepStrictEqual(strayEnds, []);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].children.length, 2);
    assert.strictEqual(blocks[0].children[0].children.length, 1);
  });

  test('the same region in a RegionCampain file reads identically', () => {
    assert.deepStrictEqual(
      problemsOf([
        'RegionCampain',
        '  Region Gondor',
        '    Connection',
        '      Region = Rohan',
        '      DetourPoint = X:1 Y:2',
        '    End',
        '  End',
        'End',
      ]),
      [],
    );
  });

  test('a Region keyword is the union of every context that opens one', () => {
    const resolved = schema.resolve(FRAGMENT_CONTEXT, 'Region', []);

    assert.strictEqual(resolved?.kind, 'block');
    assert.ok(
      ['Connection', 'RestrictBuildings'].every(
        (name) =>
          schema.resolve(resolved?.childContext ?? '', name, [])?.kind ===
          'block',
      ),
    );
  });

  test('a misspelt field inside a fragment block still errors', () => {
    assert.deepStrictEqual(
      problemsOf(
        ['  Region Gondor', '    Connectionn', '    End', '  End'],
        true,
      ).length,
      1,
    );
  });
});

suite('SAGE INI grammar: Generals flat ParticleSystem', () => {
  test('each block is one hint, not a warning per line', () => {
    const lines = [
      'ParticleSystem OldSmoke',
      '  Priority = WEAPON_EXPLOSION',
      '  VolumeType = SPHERE',
      '  AngularRateX = 1',
      'End',
      'ParticleSystem OldFire',
      '  Priority = CRITICAL',
      'End',
    ];
    const parsed = parseSageIni(lines, schema);
    const problems = findSageIniProblems(parsed, schema);

    assert.deepStrictEqual(
      problems.map(({ line, severity }) => [line, severity]),
      [
        [0, 'hint'],
        [5, 'hint'],
      ],
    );
    assert.deepStrictEqual(parsed.strayEnds, []);
    assert.ok(parsed.blocks.every((block) => block.isLegacy));
    assert.strictEqual(parsed.blocks[0].context, UNCHECKED_CONTEXT);
  });

  test('a ParticleSystem nugget inside an FXList is not legacy', () => {
    const lines = [
      'FXList Boom',
      '  ParticleSystem',
      '    Name = Smoke',
      '  End',
      'End',
    ];

    assert.deepStrictEqual(
      findSageIniProblems(parseSageIni(lines, schema), schema),
      [],
    );
  });
});

/** Rows of mint's table.rs, read the way the build script reads them */
const MINT_TABLE = [
  process.env.MINT_TABLE_RS,
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'mint2',
    'crates',
    'sage',
    'ini',
    'src',
    'table.rs',
  ),
].find((path) => path !== undefined && existsSync(path));

const RULE_TABLES = [
  'OBJECT_MODEL_RULES',
  'PARTICLE_RULES',
  'PRIORITY_BLOCK_RULES',
  'AUDIO_RULES',
  'HORDE_CONTAIN_RULES',
  'CORPUS_FILE_SCOPE_RULES',
  'CORPUS_INTERIOR_RULES',
  'LIVING_WORLD_RULES',
];

type Rule = [string, string, boolean];

const rulesOfMint = (path: string): Rule[] => {
  const source = readFileSync(path, 'utf8').replace(/\/\/.*$/gm, '');

  return RULE_TABLES.flatMap((table) => {
    const start = source.indexOf(`pub const ${table}:`);
    const open = source.indexOf('= &[', start) + 4;
    const body = source.slice(open, source.indexOf('\n];', open));

    return Array.from(
      body.matchAll(/\(\s*"([^"]*)",\s*"([^"]*)",\s*(true|false),?\s*\)/g),
      ([, context, keyword, opens]): Rule => [
        context.toLowerCase(),
        keyword,
        opens === 'true',
      ],
    );
  });
};

const rulesInData = data.rules as Rule[];
const keyOf = ([context, keyword]: Rule) =>
  `${context}\0${keyword.toLowerCase()}`;

suite('SAGE INI schema drift from mint table.rs', () => {
  test('every table.rs row is in the data file', function () {
    if (!MINT_TABLE) {
      // CI has no mint checkout; the build script's output is the check there
      this.skip();
    }

    const held = new Map(rulesInData.map((rule) => [keyOf(rule), rule[2]]));
    const missing = rulesOfMint(MINT_TABLE).filter(
      (rule) => held.get(keyOf(rule)) !== rule[2],
    );

    assert.deepStrictEqual(
      missing.map(
        ([context, keyword, opens]) => `${context}/${keyword}=${opens}`,
      ),
      [],
      'run npm run build:schema against the current mint',
    );
  });

  /** The contexts a rule's context key names, from the data file alone */
  const contextsNamed = (key: string): number[] => {
    const [slot, type] = key.split(':');

    if (type !== undefined) {
      const id = Object.entries(data.modules).find(
        ([name]) => name.toLowerCase() === type,
      )?.[1];

      return id === undefined ? [] : [id as number];
    }

    const names = [
      slot,
      ...Object.entries(data.aliases as Record<string, string>)
        .filter(([, to]) => to === slot)
        .map(([from]) => from),
    ];
    const ids = new Set<number>();

    for (const name of names) {
      Object.entries(data.fileScope as Record<string, number>)
        .filter(([keyword]) => keyword.toLowerCase() === name)
        .forEach(([, id]) => ids.add(id));

      for (const type of (data.slotTypes[name] ?? []) as string[]) {
        const id = data.modules[type];

        if (id !== undefined) {
          ids.add(id);
        }
      }

      for (const context of data.contexts) {
        for (const child of context.c) {
          if (child.k.toLowerCase() !== name) {
            continue;
          }

          if (typeof child.t === 'number') {
            ids.add(child.t);
          } else if (typeof child.t === 'object') {
            Object.values(child.t as Record<string, number>).forEach((id) =>
              ids.add(id),
            );
          }
        }
      }
    }

    return [...ids];
  };

  test('the data file reads every recorded row as the row says', () => {
    const wrong: string[] = [];

    for (const [context, keyword, opens] of rulesInData) {
      if (context === '') {
        const kind = schema.resolve(ROOT_CONTEXT, keyword, [])?.kind;
        const legacy = (data.fileLegacy as string[]).includes(keyword);

        if (!legacy && kind !== (opens ? 'block' : 'field')) {
          wrong.push(`${context}/${keyword}`);
        }

        continue;
      }

      const targets = contextsNamed(context);

      if (!targets.length) {
        wrong.push(`${context}/${keyword}: no context`);
      }

      for (const id of targets) {
        const resolved = schema.resolve(String(id), keyword, ['OVERRIDE']);
        const plain = schema.resolve(String(id), keyword, ['x']);

        // A conditional opener (AddEmotion) is a field unless OVERRIDE
        const conditional = data.contexts[id].c.some(
          (child: { k: string; a?: string }) =>
            child.k.toLowerCase() === keyword.toLowerCase() && child.a,
        );

        if (
          conditional
            ? resolved?.kind !== 'block' || plain?.kind !== 'field'
            : resolved?.kind !== (opens ? 'block' : 'field')
        ) {
          wrong.push(`${context}/${keyword} in ${data.contexts[id].n}`);
        }
      }
    }

    assert.deepStrictEqual(wrong, []);
  });

  test('every closed context and alias of table.rs is recorded', () => {
    assert.ok((data.closed as string[]).includes('behavior'));
    assert.strictEqual(data.aliases.childobject, 'object');
    assert.ok(rulesInData.length > 300);
  });
});
