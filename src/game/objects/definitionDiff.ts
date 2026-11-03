import { stripComment } from '../../formats/ini/sageIniParser';
import type { SageBlock, SageDocument } from '../../formats/ini/sageIniParser';

/**
 * What a mod changed in an INI file, definition by definition and field by
 * field, rather than as a text diff: which definitions it adds and drops,
 * and in each it changes which values, named by where they sit
 * (`Body[ModuleTag_Body]/MaxHealth`). Comments, spacing and line order
 * outside a value do not count as changes.
 */

/** One value a mod changed, added or removed, named by its path in the definition */
export interface FieldChange {
  path: string;
  before?: string;
  after?: string;
}

/** The definitions a mod adds, removes and changes in one INI file */
export interface DefinitionDiff {
  added: string[];
  removed: string[];
  changed: { name: string; changes: FieldChange[] }[];
}

const definitionKey = (block: SageBlock) =>
  `${block.keyword} ${block.name?.split(/\s+/)[0] ?? ''}`.trim();

/** Formats a block's segment of a path: its keyword, and its tag or its count */
const formatPathSegment = (block: SageBlock, count: number) =>
  block.moduleTag
    ? `${block.keyword}[${block.moduleTag}]`
    : count > 1
      ? `${block.keyword}#${count}`
      : block.keyword;

/** Flattens a definition into every value it holds, by its path, as written without spacing */
export const flattenDefinition = (
  document: SageDocument,
  lines: string[],
  top: SageBlock,
): Map<string, string> => {
  const owners = new Map<number, string>();
  const paths = new Map<SageBlock, string>();
  const values = new Map<string, string>();
  const walk = (block: SageBlock, path: string) => {
    const seen = new Map<string, number>();

    for (let line = block.startLine + 1; line < block.endLine; line++) {
      owners.set(line, path);
    }
    for (const child of block.children) {
      const count = (seen.get(child.keyword.toLowerCase()) ?? 0) + 1;

      seen.set(child.keyword.toLowerCase(), count);
      paths.set(child, `${path}${formatPathSegment(child, count)}`);
      walk(child, `${path}${formatPathSegment(child, count)}/`);
    }
  };

  walk(top, '');

  const counts = new Map<string, number>();

  for (const statement of document.statements) {
    if (statement.line <= top.startLine || statement.line >= top.endLine) {
      continue;
    }

    const owner = owners.get(statement.line) ?? '';
    const base = `${owner}${statement.keyword.text}`;
    const count = (counts.get(base.toLowerCase()) ?? 0) + 1;
    const text = stripComment(lines[statement.line])
      .replace(/^[^=]*=?/, '')
      .trim()
      .replace(/\s+/g, ' ');

    counts.set(base.toLowerCase(), count);
    // A block's own line says what it is, under the block's own path
    const block = statement.block && paths.get(statement.block);

    values.set(block ?? (count > 1 ? `${base}#${count}` : base), text);
  }
  return values;
};

const readDefinitions = (document: SageDocument, lines: string[]) =>
  new Map(
    document.blocks
      .filter((block) => block.name)
      .map((block) => [
        definitionKey(block).toLowerCase(),
        {
          name: definitionKey(block),
          values: flattenDefinition(document, lines, block),
        },
      ]),
  );

/** Compares the base game's text of a file with the mod's, definition by definition */
export const diffDefinitions = (
  base: { document: SageDocument; lines: string[] },
  mod: { document: SageDocument; lines: string[] },
): DefinitionDiff => {
  const before = readDefinitions(base.document, base.lines);
  const after = readDefinitions(mod.document, mod.lines);
  const diff: DefinitionDiff = { added: [], removed: [], changed: [] };

  for (const [key, { name, values }] of after) {
    const old = before.get(key);

    if (!old) {
      diff.added.push(name);
      continue;
    }

    const changes: FieldChange[] = [];

    for (const [path, value] of values) {
      const was = old.values.get(path);

      if (was !== value) {
        changes.push({ path, before: was, after: value });
      }
    }
    for (const [path, value] of old.values) {
      if (!values.has(path)) {
        changes.push({ path, before: value });
      }
    }
    if (changes.length) {
      diff.changed.push({ name, changes });
    }
  }
  for (const [key, { name }] of before) {
    if (!after.has(key)) {
      diff.removed.push(name);
    }
  }
  return diff;
};
