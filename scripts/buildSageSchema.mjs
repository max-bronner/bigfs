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
 * usage: node scripts/buildSageSchema.mjs <path to mint's generated.rs> [commit]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OUT_PATH = 'assets/sageIniSchema.json';
const [generatedPath, mintCommit = 'unknown'] = process.argv.slice(2);

if (!generatedPath) {
  console.error('usage: buildSageSchema.mjs <generated.rs> [mint commit]');
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
    commit: mintCommit,
  },
  contexts,
  fileScope,
  modules,
  fields: previous.fields,
  references: previous.references,
  slotTypes: previous.slotTypes,
  enumValues,
};

writeFileSync(OUT_PATH, `${JSON.stringify(schema)}\n`);

console.log(
  `${contexts.length} contexts, ${Object.keys(fileScope).length} file-scope blocks, ` +
    `${Object.keys(modules).length} modules, ${Object.keys(enumValues).length} value lists ` +
    `(${Object.keys(previous.enumValues).length - Object.keys(enumValues).length} dropped as content)`,
);
