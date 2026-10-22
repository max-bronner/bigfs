/**
 * Builds the data file the SAGE INI language support reads.
 *
 * Three sources are merged:
 *
 * - one or more `data/ini` corpora, which say whether a keyword opens a block
 *   in a given context. Classification is a majority vote, decided per line by
 *   looking ahead for the `End` that would close it.
 * - the engine dump, which names the blocks the engine dispatches on and gives
 *   every field a type and whether the engine still reads it. This is what
 *   lets a hover say a field is engine defined rather than merely observed.
 * - the field to namespace map, which says what a reference value points at.
 *
 * usage: node scripts/buildSageSchema.mjs --engine <engine.json> --out <file> <corpus dir>...
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const args = process.argv.slice(2);
const readFlag = (name) => {
  const index = args.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  const [value] = args.splice(index, 2).slice(1);

  return value;
};

const enginePath = readFlag('--engine');
const outPath = readFlag('--out') ?? 'assets/sageIniSchema.json';
const corpora = args;

if (!corpora.length) {
  console.error('usage: buildSageSchema.mjs --engine <f> --out <f> <corpus>...');
  process.exit(1);
}

/**
 * Reference fields known from section 11 of SAGE-INI-FORMAT.md. This is only a
 * seed: the bulk of the map is derived from the corpus below, by checking
 * which namespace a field's values are actually defined in. The seed covers
 * fields whose values mostly live outside the corpus - art paths, localisation
 * keys - which derivation alone would miss.
 */
const SEED_REFERENCE_FIELDS = {
  Upgrade: [
    'TriggeredBy', 'ConflictsWith', 'NeededUpgrade', 'RequiredUpgradeNames',
    'Upgrades', 'UpgradeRequired', 'ForbiddenUpgrades', 'BlingUpgradeName',
    'CreateAHeroUIAllowableUpgrades', 'UpgradeToGrant', 'UpgradeName',
  ],
  Armor: ['Armor', 'ArmorSetFlag'],
  MappedImage: [
    'ButtonImage', 'SelectPortrait', 'Image', 'StrategicIcon',
    'PortraitImageName', 'ButtonImageName', 'DisabledImage', 'HiliteImage',
  ],
  EmotionNugget: ['AddEmotion'],
  FXList: [
    'EnteringStateFX', 'FireFX', 'DeathFX', 'ToppleFX', 'BounceFX',
    'GroundHitFX', 'GrabFX', 'FX', 'FXEvent', 'UpgradeFX', 'LevelUpFx',
    'PreAttackFX', 'FXList', 'FireFXPreAttack', 'VeterancyFX', 'CrushFX',
  ],
  SpecialPower: ['SpecialPowerTemplate', 'SpecialPower'],
  AudioEvent: [
    'Sound', 'SoundOnDamaged', 'SoundOnReallyDamaged', 'InitiateSound',
    'AnimationSound', 'SelfBuildingLoop', 'UnderConstruction', 'SoundAmbient',
    'SoundAmbientDamaged', 'SoundAmbientReallyDamaged', 'SoundAmbientRubble',
    'SoundEnter', 'SoundExit', 'SoundCreated', 'SoundFallingFromPlane',
    'SoundImpact', 'SoundMoveStart', 'SoundMoveStartDamaged', 'SoundSelect',
    'VoiceSelect', 'VoiceMove', 'VoiceAttack', 'VoiceGuard', 'VoiceFear',
    'VoiceCreated', 'VoiceFullyCreated', 'VoiceTaskComplete', 'VoiceRetreat',
    'VoiceAttackCharge', 'VoiceAttackMachine', 'VoiceAttackStructure',
    'VoiceEnterStateAttack', 'VoiceGarrison', 'VoiceSelectBattle',
    'VoiceCombineWithHorde', 'VoiceMoveToCamp', 'VoiceMoveWhileAttacking',
    'VoicePriority', 'TurretMoveLoop', 'Subsounds',
  ],
  CommandSet: ['CommandSet'],
  Locomotor: ['Locomotor'],
  Object: [
    'ObjectNames', 'TargetNames', 'ThingTemplate', 'GrabObject', 'WorkerName',
    'Object', 'ProjectileTemplateName', 'BuildVariations', 'CrateObject',
  ],
  ModifierList: ['AttributeModifiers', 'AttributeModifier', 'BonusName'],
  DamageFX: ['DamageFX'],
  Weapon: [
    'WarheadTemplateName', 'SpecialWeapon', 'Weapon', 'ChaseWeapon',
    'ProjectileTemplateName',
  ],
  CommandButton: ['CommandButtonName', 'ToggleButtonName'],
  ObjectCreationList: ['OCL', 'CreationList', 'DamageCreationList', 'OCLList'],
  MouseCursor: ['CursorName', 'InvalidCursorName'],
  StanceTemplate: ['StanceTemplate'],
  DialogEvent: ['Audio'],
  Science: ['RequiredSciences', 'Science', 'Sciences'],
  ExperienceLevel: ['ExperienceLevel'],
  Multisound: ['Subsounds'],
};

/**
 * Module slots, whose first value names a concrete type that decides the legal
 * field set. Seeded rather than inferred: telling a slot apart from a named
 * block needs the engine's own dispatch, which the dump does not expose.
 */
const SEED_SLOTS = [
  'Behavior', 'Draw', 'Body', 'ClientBehavior', 'ClientUpdate', 'Update',
  'Color', 'Alpha', 'Wind', 'Physics', 'EmissionVelocity', 'EmissionVolume',
  'Event', 'Emitter', 'Transition', 'ParticleSystem',
];

const stripComment = (line) => {
  const semicolon = line.indexOf(';');
  const slashes = line.indexOf('//');

  if (semicolon < 0) return slashes < 0 ? line : line.slice(0, slashes);
  if (slashes < 0) return line.slice(0, semicolon);

  return line.slice(0, Math.min(semicolon, slashes));
};

const tokenize = (content) => content.split(/[\s=]+/).filter(Boolean);
const indentOf = (line) => line.length - line.trimStart().length;
const isEnd = (content) => /^end$/i.test(content.trim());

/** Whether a line opens a block, decided by looking ahead for its End */
const opensBlock = (lines, index) => {
  const indent = indentOf(lines[index]);

  for (let next = index + 1; next < lines.length; next += 1) {
    const content = stripComment(lines[next]);

    if (!content.trim()) continue;
    if (indentOf(lines[next]) > indent) continue;

    return isEnd(content) && indentOf(lines[next]) === indent;
  }

  return false;
};

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    return statSync(path).isDirectory() ? walk(path) : [path];
  });

// context -> keyword -> { block: n, field: n }
const votes = new Map();
// slot -> module type names observed after it
const slotTypes = new Map();
// field -> SCREAMING_SNAKE values observed on it, which is what completion offers
const enumValues = new Map();
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
// folded keyword -> the casing the corpus writes it with, by majority
const casingVotes = new Map();
// namespace -> the names declared in it, which is what a reference resolves to
const declared = new Map();
// every #define name, which is a flat global namespace of its own
const macros = new Map();
// field -> the values seen on it, used to derive what the field references
const fieldValues = new Map();
const slots = new Set(SEED_SLOTS.map((s) => s.toLowerCase()));

const vote = (context, keyword, kind) => {
  const key = context.toLowerCase();
  const byKeyword = votes.get(key) ?? new Map();
  const tally = byKeyword.get(keyword.toLowerCase()) ?? { block: 0, field: 0 };

  tally[kind] += 1;
  byKeyword.set(keyword.toLowerCase(), tally);
  votes.set(key, byKeyword);
};

let files = 0;

for (const corpus of corpora) {
  for (const file of walk(corpus)) {
    if (!['.ini', '.inc', '.bhav'].includes(extname(file).toLowerCase())) {
      continue;
    }

    files += 1;

    const lines = readFileSync(file, 'latin1').split(/\r?\n/);
    const stack = [];
    let inScript = false;

    lines.forEach((line, index) => {
      if (inScript) {
        if (/^\s*EndScript\s*$/i.test(line)) inScript = false;
        return;
      }

      if (/^\s*BeginScript\s*$/i.test(line)) {
        inScript = true;
        return;
      }

      const content = stripComment(line).trim();

      if (!content) return;

      if (content.startsWith('#')) {
        // A #define is global once any file is loaded, so it is recorded flat
        const macro = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/i.exec(
          content,
        );

        if (macro) {
          macros.set(macro[1].toLowerCase(), {
            name: macro[1],
            value: macro[2].trim(),
          });
        }

        return;
      }

      if (isEnd(content)) {
        stack.pop();
        return;
      }

      const [keyword, ...values] = tokenize(content);
      const context = stack.length ? stack[stack.length - 1] : '<ROOT>';
      const opens = opensBlock(lines, index);

      vote(context, keyword, opens ? 'block' : 'field');

      const slotKey = keyword.toLowerCase();
      const spellings = casingVotes.get(slotKey) ?? new Map();

      spellings.set(keyword, (spellings.get(keyword) ?? 0) + 1);
      casingVotes.set(slotKey, spellings);

      if (opens && context === '<ROOT>' && values[0]) {
        const names = declared.get(slotKey) ?? new Set();

        names.add(values[0].toLowerCase());
        declared.set(slotKey, names);
      }

      if (opens) {
        const isSlot = slots.has(slotKey) && values[0];

        if (isSlot) {
          const seen = slotTypes.get(slotKey) ?? new Set();

          seen.add(values[0]);
          slotTypes.set(slotKey, seen);
        }

        stack.push(isSlot ? `${keyword}:${values[0]}` : keyword);

        return;
      }

      // Every value a field carries, so the reference map can be derived from
      // what the names actually resolve to rather than guessed
      for (const value of values) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || value.length < 2) {
          continue;
        }

        const seen = fieldValues.get(slotKey) ?? new Set();

        if (seen.size < 400) {
          seen.add(value);
        }

        fieldValues.set(slotKey, seen);
      }
    });
  }
}

// A SCREAMING_SNAKE value is a vocabulary word unless it is a macro, which is
// a name that resolves rather than a value in its own right
for (const [field, values] of fieldValues) {
  for (const value of values) {
    if (!SCREAMING_SNAKE.test(value) || macros.has(value.toLowerCase())) {
      continue;
    }

    const seen = enumValues.get(field) ?? new Set();

    seen.add(value);
    enumValues.set(field, seen);
  }
}

const contexts = {};

for (const [context, byKeyword] of votes) {
  const compact = {};

  for (const [keyword, tally] of byKeyword) {
    compact[keyword] = tally.block > tally.field ? 1 : 0;
  }

  contexts[context] = compact;
}

// Engine dump: authoritative block names, and a type per field name
let engineBlocks = [];
const fields = {};

if (enginePath) {
  const engine = JSON.parse(readFileSync(enginePath, 'utf8'));

  engineBlocks = (engine.dispatch ?? []).slice().sort();

  const merged = new Map();

  for (const table of [
    ...(engine.tables_gamedat ?? []),
    ...(engine.tables_worldbuilder ?? []),
  ]) {
    for (const field of table.fields ?? []) {
      const key = field.name.toLowerCase();
      const record = merged.get(key) ?? { types: new Set(), used: false };

      record.types.add(field.type);
      record.used = record.used || field.used;
      merged.set(key, record);
    }
  }

  for (const [key, record] of merged) {
    // `t` is the type, or the types when the engine reads the name several
    // ways; `u` is 0 when no engine table still reads it
    fields[key] = {
      t: [...record.types].sort().join('|'),
      u: record.used ? 1 : 0,
    };
  }
}

/**
 * Derives what each field references, by checking where its values are
 * actually declared. A field counts as pointing into a namespace when enough
 * of its distinct values are names in it - the engine keeps one global store
 * per type, so a name either is in that store or it is not.
 */
const MIN_VALUES = 3;
const MIN_SHARE = 0.5;

const references = {};

const addReference = (field, namespace) => {
  const key = field.toLowerCase();

  references[key] = [...new Set([...(references[key] ?? []), namespace])];
};

// Canonical namespace casing, from the root blocks the corpus declares
const namespaceCasing = new Map();

for (const [folded] of declared) {
  namespaceCasing.set(folded, casingVotes.get(folded)
    ? [...casingVotes.get(folded)].sort((a, b) => b[1] - a[1])[0][0]
    : folded);
}

let derived = 0;

for (const [field, values] of fieldValues) {
  if (values.size < MIN_VALUES) {
    continue;
  }

  const folded = [...values].map((value) => value.toLowerCase());

  for (const [namespace, names] of declared) {
    // A field that merely shares its name with a block is not a reference to
    // it; what matters is how many of its values are declared there
    const hits = folded.filter((value) => names.has(value)).length;

    if (hits >= MIN_VALUES && hits / folded.length >= MIN_SHARE) {
      addReference(field, namespaceCasing.get(namespace) ?? namespace);
      derived += 1;
    }
  }
}

// The seed covers fields whose targets live outside the corpus, which
// derivation cannot see
for (const [namespace, fieldNames] of Object.entries(SEED_REFERENCE_FIELDS)) {
  for (const name of fieldNames) {
    addReference(name, namespace);
  }
}

/**
 * Caps a vocabulary so one sprawling field cannot dominate the file. Truncated
 * rather than dropped: `KindOf` alone has hundreds of values and is the field
 * a modder most wants completed, so a partial list beats none.
 */
const VALUE_LIMIT = 320;

const compactSets = (source, limit, least = 1) =>
  Object.fromEntries(
    [...source]
      .map(([key, values]) => [key, [...values].sort().slice(0, limit)])
      .filter(([, values]) => values.length >= least),
  );

const out = {
  version: 3,
  game: enginePath ? JSON.parse(readFileSync(enginePath, 'utf8'))._meta?.game ?? 'unknown' : 'unknown',
  slots: [...slots].sort(),
  contexts,
  engineBlocks,
  fields,
  references,
  casing: Object.fromEntries(
    [...casingVotes].map(([folded, spellings]) => [
      folded,
      [...spellings].sort((a, b) => b[1] - a[1])[0][0],
    ]),
  ),
  // Every slot is kept, even one with a single type; a vocabulary of one is
  // not worth completing, so those are dropped
  slotTypes: compactSets(slotTypes, 400),
  enumValues: compactSets(enumValues, VALUE_LIMIT, 2),
  // Macros are not shipped: they are indexed from the archives the user has
  // open, so a mod's own #define resolves and carries a real location. They
  // are collected here only to keep macro names out of the vocabularies.
};

writeFileSync(outPath, JSON.stringify(out));

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`corpus files:   ${files}`);
console.log(`contexts:       ${Object.keys(contexts).length}`);
console.log(`engine blocks:  ${engineBlocks.length}`);
console.log(`engine fields:  ${Object.keys(fields).length}`);
console.log(`module slots:   ${Object.keys(out.slotTypes).length}`);
console.log(`enum fields:    ${Object.keys(out.enumValues).length}`);
console.log(`macros seen:    ${macros.size} (indexed at runtime, not shipped)`);
console.log(`reference flds: ${Object.keys(references).length} (${derived} derived)`);
console.log(`written:        ${outPath} (${kb(readFileSync(outPath).length)})`);
