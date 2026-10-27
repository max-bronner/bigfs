/**
 * Builds the grammar the SAGE INI language support reads, from mint's field
 * tables.
 *
 * The block and field structure comes from mint's
 * `crates/sage/ini/src/tables/generated.rs`, which mint extracts from both
 * games' own editors (`docs/research/ini-bfme-delta.md` section 19): every
 * file-scope block, module and nested block, the field names each accepts, the
 * keywords that open a nested block, and which game each name belongs to.
 * Measured against the shipped data it accepts 99.95% of field statements and
 * 99.90% of block openers.
 *
 * Field types, reference namespaces, module types per slot and value
 * vocabularies are carried over from the current data file, minus value lists
 * that name assets (bones, sub-objects, models, files), which are game content
 * rather than grammar.
 *
 * The hand-written grammar of mint's `crates/sage/ini/src/table.rs` is layered
 * on top (the `*_RULES`, `*_CLOSED` and `OBJECT_MODEL_ALIASES` tables), since
 * the editors' tables do not hold what the games parse by other means: the
 * inline blocks the corpus writes (`MeleeBehavior`, `Stance`, ...), the
 * definitions with no field table (`StanceTemplate`, `StrategicHUD`), and the
 * one-line records at file scope (`LODPreset`, `BenchProfile`). Every row is
 * also written to the data file as `rules`, which the drift test reads.
 *
 * usage: node scripts/buildSageSchema.mjs <generated.rs> <table.rs> [commit]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OUT_PATH = 'assets/sageIniSchema.json';
const [generatedPath, tablePath, mintCommit = 'unknown'] =
  process.argv.slice(2);

if (!generatedPath || !tablePath) {
  console.error(
    'usage: buildSageSchema.mjs <generated.rs> <table.rs> [commit]',
  );
  process.exit(1);
}

const source = readFileSync(generatedPath, 'utf8');
const previous = JSON.parse(readFileSync(OUT_PATH, 'utf8'));

/** Title masks as generated.rs spells them: bit 0 BFME II, bit 1 ROTWK */
const MASKS = { NONE: 0, B2: 1, RK: 2, BOTH: 3 };

const fieldSets = new Map();

for (const [, id, body] of source.matchAll(
  /^const F(\d+): &\[Field\] = &\[(.*)\];$/gm,
)) {
  fieldSets.set(
    id,
    [...body.matchAll(/Field\("([^"]+)", (\w+)\)/g)].map(([, name, mask]) => [
      name,
      MASKS[mask],
    ]),
  );
}

/** The lines of one `static NAME: ... = &[ ... ];` list */
const listLines = (name) => {
  const start = source.indexOf(`static ${name}:`);
  const end = source.indexOf('\n];', start);

  return source.slice(start, end).split('\n').slice(1);
};

const parseChild = (text) => {
  const [, keyword, mask, target] = text.match(
    /keyword: "([^"]+)", titles: (\w+), target: Target::(.*)$/,
  );

  if (target === 'Module') {
    return { k: keyword, m: MASKS[mask], t: 'module' };
  }

  const context = target.match(/^Context\((\d+)\)$/);

  if (context) {
    return { k: keyword, m: MASKS[mask], t: Number(context[1]) };
  }

  return {
    k: keyword,
    m: MASKS[mask],
    t: Object.fromEntries(
      [...target.matchAll(/\("([^"]+)", (\d+)\)/g)].map(([, arg, id]) => [
        arg,
        Number(id),
      ]),
    ),
  };
};

const contexts = listLines('CONTEXTS').map((line) => {
  const fields = new Map();
  let wildcard = 0;

  for (const [, id, titles, wild] of line.matchAll(
    /Table \{ fields: F(\d+), titles: (\w+), wildcard: (\w+)/g,
  )) {
    const tableMask = MASKS[titles];

    wildcard |= MASKS[wild] & tableMask;

    for (const [name, mask] of fieldSets.get(id)) {
      fields.set(name, (fields.get(name) ?? 0) | (mask & tableMask));
    }
  }

  const children = [...line.matchAll(/Child \{ (.*?) \}/g)].map(([, text]) =>
    parseChild(text),
  );

  return { f: [...fields], w: wildcard, c: children };
});

const readMap = (name) =>
  Object.fromEntries(
    listLines(name)
      .map((line) => line.match(/\("([^"]+)", (\d+)\)/))
      .filter(Boolean)
      .map(([, key, id]) => [key, Number(id)]),
  );

const fileScope = readMap('FILE_SCOPE');
const modules = readMap('MODULES');

// A context is named after the first path that reaches it, which is what a
// completion detail or a diagnostic shows
const names = new Array(contexts.length);
const queue = [];

for (const [name, id] of Object.entries(fileScope)) {
  names[id] ??= name;
  queue.push(id);
}

for (const [name, id] of Object.entries(modules)) {
  names[id] ??= name;
  queue.push(id);
}

while (queue.length) {
  const id = queue.shift();

  for (const child of contexts[id].c) {
    const targets =
      typeof child.t === 'number'
        ? [[child.k, child.t]]
        : typeof child.t === 'object'
          ? Object.entries(child.t).map(([arg, target]) => [
              `${child.k} ${arg}`,
              target,
            ])
          : [];

    for (const [label, target] of targets) {
      if (names[target] === undefined) {
        names[target] = `${names[id]} > ${label}`;
        queue.push(target);
      }
    }
  }
}

contexts.forEach((context, id) => {
  context.n = names[id] ?? `#${id}`;
});

// ---------------------------------------------------------------------------
// mint's hand-written grammar, crates/sage/ini/src/table.rs
// ---------------------------------------------------------------------------

const tableSource = readFileSync(tablePath, 'utf8').replace(/\/\/.*$/gm, '');

/** The body of one `pub const NAME: ... = &[ ... ];` */
const constBody = (name) => {
  const start = tableSource.indexOf(`pub const ${name}:`);

  if (start < 0) {
    throw new Error(`table.rs has no ${name}`);
  }

  const open = tableSource.indexOf('= &[', start) + 4;

  return tableSource.slice(open, tableSource.indexOf('\n];', open));
};

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
const CLOSED_TABLES = [
  'OBJECT_MODEL_CLOSED',
  'PARTICLE_CLOSED',
  'PRIORITY_BLOCK_CLOSED',
  'AUDIO_CLOSED',
  'HORDE_CONTAIN_CLOSED',
  'CORPUS_CLOSED',
];

const ruleSet = new Map();

for (const table of RULE_TABLES) {
  for (const [, context, keyword, opens] of constBody(table).matchAll(
    /\(\s*"([^"]*)",\s*"([^"]*)",\s*(true|false),?\s*\)/g,
  )) {
    // The same row in two tables is one row; a later table wins a conflict,
    // as `BlockTable::extend` does
    ruleSet.set(`${context.toLowerCase()}\0${keyword}`, [
      context.toLowerCase(),
      keyword,
      opens === 'true',
    ]);
  }
}

const rules = [...ruleSet.values()];
const closed = [
  ...new Set(
    CLOSED_TABLES.flatMap((table) =>
      [...constBody(table).matchAll(/"([^"]+)"/g)].map(([, name]) => name),
    ),
  ),
];
const aliases = Object.fromEntries(
  [
    ...constBody('OBJECT_MODEL_ALIASES').matchAll(
      /\("([^"]+)",\s*"([^"]+)"\)/g,
    ),
  ].map(([, from, to]) => [from, to]),
);

if (rules.some(([context]) => context === '*')) {
  throw new Error('a "*" context row needs a rule here');
}

/**
 * Fields whose block-or-field answer depends on the line's own first value.
 * `BlockTable::opens_block` checks `AddEmotion = OVERRIDE Name ... End`
 * ahead of every row (table.rs, `impl BlockOpener for BlockTable`): `OVERRIDE`
 * defines the emotion inline and opens a block, anything else names one.
 */
const CONDITIONAL_OPENERS = { addemotion: 'OVERRIDE' };

/**
 * File-scope blocks the games do not parse. `particlesystem.ini` is
 * Generals' flat format left in the tree: no field table in either editor has
 * its names (ini-bfme-delta.md 19.4), so mint reads it and bigFS reports it
 * once per block instead of once per line.
 */
const LEGACY_FILE_SCOPE = ['ParticleSystem'];

const mentions = (name) => name.toLowerCase();

/** Every context a header keyword reaches, by lowercased keyword */
const reached = new Map();
const reach = (keyword, id) => {
  const key = mentions(keyword);

  if (!reached.has(key)) {
    reached.set(key, new Set());
  }

  reached.get(key).add(id);
};

const moduleIdOf = (name) =>
  Object.entries(modules).find(([n]) => mentions(n) === mentions(name))?.[1];

const indexReaches = () => {
  reached.clear();

  for (const [name, id] of Object.entries(fileScope)) {
    reach(name, id);
  }

  for (const context of contexts) {
    for (const child of context.c) {
      if (typeof child.t === 'number') {
        reach(child.k, child.t);
      } else if (typeof child.t === 'object') {
        Object.values(child.t).forEach((id) => reach(child.k, id));
      }
    }
  }

  // A module slot reaches the context of every module it accepts
  for (const [slot, types] of Object.entries(previous.slotTypes)) {
    for (const type of types) {
      const id = moduleIdOf(type);

      if (id !== undefined) {
        reach(slot, id);
      }
    }
  }
};

/** Which context keywords mean the same context, per OBJECT_MODEL_ALIASES */
const sameContext = (context) => [
  context,
  ...Object.entries(aliases)
    .filter(([, to]) => to === context)
    .map(([from]) => from),
];

/** The contexts a rule's context key names; `slot:type` names one module */
const contextsNamed = (key) => {
  const [slot, type] = key.split(':');

  if (type !== undefined) {
    const id = moduleIdOf(type);

    return id === undefined ? [] : [id];
  }

  return [
    ...new Set(
      sameContext(slot).flatMap((name) => [...(reached.get(name) ?? [])]),
    ),
  ];
};

const spelling = new Map();

for (const [, keyword] of rules) {
  spelling.set(mentions(keyword), spelling.get(mentions(keyword)) ?? keyword);
}

const handWrittenByKeyword = new Map();

/**
 * One context per keyword for a block the editors hold no table for. Any
 * field is read in it, as mint closes these contexts without listing fields.
 */
const handWritten = (keyword) => {
  const key = mentions(keyword);

  if (!handWrittenByKeyword.has(key)) {
    contexts.push({ f: [], w: 3, c: [], n: spelling.get(key) ?? keyword });
    handWrittenByKeyword.set(key, contexts.length - 1);
  }

  return handWrittenByKeyword.get(key);
};

const hasChild = (context, keyword) =>
  context.c.some((child) => mentions(child.k) === mentions(keyword));

const fileLeaves = {};
const fileLegacy = [];

// File-scope rows first: they create the contexts the interior rows hang on
for (const [context, keyword, opens] of rules) {
  if (context !== '') {
    continue;
  }

  if (LEGACY_FILE_SCOPE.includes(keyword)) {
    fileLegacy.push(keyword);
    continue;
  }

  const existing = Object.keys(fileScope).find(
    (name) => mentions(name) === mentions(keyword),
  );

  if (!opens) {
    fileLeaves[keyword] = 3;
  } else if (existing === undefined) {
    fileScope[keyword] = handWritten(keyword);
  }
}

const slotNames = new Set(Object.keys(previous.slotTypes).map(mentions));
const unreached = new Set();
let applied;

// Interior rows may hang on a context an earlier row creates (`Stance` under
// `StanceTemplate`, `MeleeBehavior` under `Stance`), so run to a fixed point
do {
  applied = 0;
  indexReaches();
  unreached.clear();

  for (const [context, keyword, opens] of rules) {
    if (context === '') {
      continue;
    }

    const targets = contextsNamed(context);

    if (!targets.length) {
      unreached.add(`${context}/${keyword}`);
      continue;
    }

    for (const id of targets) {
      const parent = contexts[id];
      const conditional = CONDITIONAL_OPENERS[mentions(keyword)];

      if (opens) {
        if (hasChild(parent, keyword)) {
          continue;
        }

        const candidates = [...(reached.get(mentions(keyword)) ?? [])];
        // A module slot picks its field set by the first value, wherever it sits
        const target = slotNames.has(mentions(keyword))
          ? 'module'
          : candidates.length === 1
            ? candidates[0]
            : handWritten(keyword);

        parent.c.push({ k: spelling.get(mentions(keyword)), m: 3, t: target });
        applied += 1;
      } else if (conditional !== undefined) {
        const child = parent.c.find((c) => mentions(c.k) === mentions(keyword));

        if (child && child.a === undefined) {
          child.a = conditional;
          applied += 1;
        }
      } else {
        const at = parent.c.findIndex(
          (c) => mentions(c.k) === mentions(keyword),
        );

        if (at >= 0) {
          parent.c.splice(at, 1);
          applied += 1;
        }
      }

      // A leaf row means the keyword is a field of its context
      if (
        !opens &&
        !parent.w &&
        !parent.f.some(([name]) => mentions(name) === mentions(keyword))
      ) {
        parent.f.push([keyword, 3]);
        applied += 1;
      }
    }
  }
} while (applied);

// Names for the contexts the rows created, after the first path that reaches them
contexts.forEach((context, id) => {
  context.n ??= `#${id}`;
});

/** Value lists that name assets of the game rather than engine vocabulary */
const CONTENT_VALUES =
  /bone|subobject|model|mesh|skeleton|texture|filename|^animation$|animationname|anim$|^map$|mapname|displayname|^key$|shadow|window|^stat|shader|^turret$|editorsorting/;

const enumValues = Object.fromEntries(
  Object.entries(previous.enumValues).filter(
    ([field]) => !CONTENT_VALUES.test(field),
  ),
);

const schema = {
  version: 4,
  source: {
    repository: 'mint',
    file: 'crates/sage/ini/src/tables/generated.rs',
    table: 'crates/sage/ini/src/table.rs',
    commit: mintCommit,
  },
  contexts,
  fileScope,
  modules,
  fileLeaves,
  fileLegacy,
  rules,
  closed,
  aliases,
  fields: previous.fields,
  references: previous.references,
  slotTypes: previous.slotTypes,
  enumValues,
};

writeFileSync(OUT_PATH, `${JSON.stringify(schema)}\n`);

console.log(
  `${rules.length} table.rs rules, ${closed.length} closed contexts, ` +
    `${unreached.size} rules on contexts nothing reaches: ${[...unreached].join(', ')}`,
);
console.log(
  `${contexts.length} contexts, ${Object.keys(fileScope).length} file-scope blocks, ` +
    `${Object.keys(modules).length} modules, ${Object.keys(enumValues).length} value lists ` +
    `(${Object.keys(previous.enumValues).length - Object.keys(enumValues).length} dropped as content)`,
);
