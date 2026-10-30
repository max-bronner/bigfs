import type { SageBlock, SageStatement } from '../../formats/ini/sageIniParser';

/**
 * An object as the game builds it from a `ChildObject` or `ObjectReskin`
 * lineage: the parent's whole definition, then the child's lines on top.
 * The composition rules, and where each comes from:
 *
 * - A field the child writes replaces the inherited one of that name. A
 *   bit-string field written only as `+NAME`/`-NAME` edits the inherited
 *   set instead (EA's `BitFlagsIO`; a bare list clears first).
 * - A module the child declares replaces the inherited module with the same
 *   tag; a `Body` replaces the inherited body whatever its tag, since an
 *   object has one (mint's ChildObject research: tag-keyed, plus the four
 *   retail bodies redeclared under a new tag).
 * - `RemoveModule <tag>` drops an inherited module; `ReplaceModule <tag>`
 *   drops it and adds what it holds; `AddModule` and `InheritableModule`
 *   add what they hold (Generals `ThingTemplate.cpp:739-831`).
 * - Any other block, such as `WeaponSet` or `ArmorSet`, is a list: the
 *   first one the child declares clears every inherited one of its keyword
 *   (Generals `ThingTemplate.cpp:900-935`).
 *
 * The result is text: the composed block, each line marked with the
 * definition it comes from.
 */

/** One definition of a lineage: its own lines and its parse */
export interface LineageStep {
  name: string;
  lines: string[];
  block: SageBlock;
  statements: SageStatement[];
}

interface FieldEntry {
  kind: 'field';
  keyword: string;
  text: string;
  from: string;
  note?: string;
}

interface BlockEntry {
  kind: 'block';
  keyword: string;
  tag?: string;
  /** The block's lines, header to End, as written */
  text: string[];
  from: string;
  note?: string;
}

type Entry = FieldEntry | BlockEntry;

const MODULE_WRAPPERS = ['addmodule', 'inheritablemodule'];

const lower = (text: string | undefined) => text?.toLowerCase() ?? '';

/** Strips a line's comment and trailing spaces */
const stripLineComment = (line: string) => line.replace(/\s*(;|\/\/).*$/, '').trimEnd();

/** Collects what one definition declares at its own level, in order, and the modules it removes or replaces */
const readOwnEntries = (
  step: LineageStep,
): { entries: Entry[]; removals: string[]; replacements: string[] } => {
  const entries: Entry[] = [];
  const removals: string[] = [];
  const replacements: string[] = [];
  const top = step.block;
  const blockText = (block: SageBlock) =>
    step.lines
      .slice(block.startLine, block.endLine + 1)
      .map((line) => line.trimEnd());
  const moduleEntry = (block: SageBlock): BlockEntry => ({
    kind: 'block',
    keyword: block.keyword,
    tag: block.moduleTag,
    text: blockText(block),
    from: step.name,
  });
  const byLine = new Map<number, Entry[]>();
  const add = (line: number, entry: Entry) =>
    byLine.set(line, [...(byLine.get(line) ?? []), entry]);

  for (const block of top.children) {
    const keyword = lower(block.keyword);

    if (MODULE_WRAPPERS.includes(keyword)) {
      block.children.forEach((child) =>
        add(child.startLine, moduleEntry(child)),
      );
    } else if (keyword === 'replacemodule') {
      const tag = /^\s*\S+\s+(\S+)/.exec(
        stripLineComment(step.lines[block.startLine]),
      )?.[1];

      if (tag) {
        replacements.push(tag);
      }
      block.children.forEach((child) =>
        add(child.startLine, moduleEntry(child)),
      );
    } else {
      add(block.startLine, moduleEntry(block));
    }
  }

  const inside = (line: number) =>
    top.children.some(
      (block) => block.startLine <= line && line <= block.endLine,
    );

  for (const statement of step.statements) {
    if (
      statement.kind !== 'field' ||
      statement.line <= top.startLine ||
      statement.line >= top.endLine ||
      inside(statement.line)
    ) {
      continue;
    }
    if (lower(statement.keyword.text) === 'removemodule') {
      const tag = statement.values[0]?.text;

      if (tag) {
        removals.push(tag);
      }
      continue;
    }
    add(statement.line, {
      kind: 'field',
      keyword: statement.keyword.text,
      text: stripLineComment(step.lines[statement.line]).trim(),
      from: step.name,
    });
  }

  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    entries.push(...byLine.get(line)!);
  }
  return { entries, removals, replacements };
};

const splitFieldValues = (fieldText: string) =>
  fieldText
    .replace(/^[^=]*=\s*/, '')
    .split(/\s+/)
    .filter(Boolean);

/** Applies `+A -B` edits to an inherited bit string */
const editBits = (inherited: string[], edits: string[]): string[] => {
  const result = inherited.filter((value) => lower(value) !== 'none');

  for (const edit of edits) {
    const name = edit.slice(1);
    const at = result.findIndex((value) => lower(value) === lower(name));

    if (edit.startsWith('+') && at < 0) {
      result.push(name);
    } else if (edit.startsWith('-') && at >= 0) {
      result.splice(at, 1);
    }
  }
  return result;
};

/** Composes a lineage, root first, into the effective definition's text */
export const composeLineage = (
  lineage: LineageStep[],
  header: string,
): string => {
  let entries: Entry[] = [];

  lineage.forEach((step, depth) => {
    const own = readOwnEntries(step);

    if (depth === 0) {
      entries = own.entries;
      return;
    }

    const dropped = new Set([...own.removals, ...own.replacements].map(lower));

    entries = entries.filter(
      (entry) => entry.kind !== 'block' || !dropped.has(lower(entry.tag)),
    );

    const clearedLists = new Set<string>();

    for (const entry of own.entries) {
      if (entry.kind === 'field') {
        const at = entries.findIndex(
          (each) =>
            each.kind === 'field' &&
            lower(each.keyword) === lower(entry.keyword),
        );
        const values = splitFieldValues(entry.text);
        const isBitEdit =
          values.length > 0 && values.every((value) => /^[+-]\S/.test(value));

        if (at < 0) {
          entries.push({ ...entry, note: 'added' });
        } else if (isBitEdit) {
          const inherited = entries[at] as FieldEntry;
          const result = editBits(splitFieldValues(inherited.text), values);

          entries[at] = {
            ...entry,
            text: `${entry.keyword} = ${result.join(' ')}`,
            note: `edits ${inherited.from}'s: ${values.join(' ')}`,
          };
        } else {
          const inherited = entries[at] as FieldEntry;

          entries[at] = {
            ...entry,
            note: `was ${splitFieldValues(inherited.text).join(' ')} in ${inherited.from}`,
          };
        }
        continue;
      }

      const sameTag =
        entry.tag !== undefined
          ? entries.findIndex(
              (each) =>
                each.kind === 'block' && lower(each.tag) === lower(entry.tag),
            )
          : -1;
      const sameBody =
        sameTag < 0 && lower(entry.keyword) === 'body'
          ? entries.findIndex(
              (each) => each.kind === 'block' && lower(each.keyword) === 'body',
            )
          : -1;
      const replaced = sameTag >= 0 ? sameTag : sameBody;

      if (replaced >= 0) {
        entries[replaced] = {
          ...entry,
          note: `replaces ${(entries[replaced] as BlockEntry).from}'s`,
        };
      } else if (entry.tag === undefined) {
        // A list block: the child's first one clears the inherited ones
        const key = lower(entry.keyword);
        const inherited = entries.filter(
          (each) =>
            each.kind === 'block' &&
            each.tag === undefined &&
            lower(each.keyword) === key,
        );

        if (!clearedLists.has(key) && inherited.length) {
          const at = entries.indexOf(inherited[0]);

          entries = entries.filter((each) => !inherited.includes(each));
          entries.splice(at, 0, {
            ...entry,
            note: `replaces ${inherited.length} inherited ${entry.keyword}`,
          });
        } else {
          entries.push({ ...entry, note: 'added' });
        }
        clearedLists.add(key);
      } else {
        entries.push({ ...entry, note: 'added' });
      }
    }
  });

  const out = [
    `; The definition as the game builds it, composed from ${lineage.map((step) => step.name).join(' > ')}`,
    '; Read-only. Each line says where it comes from; edit it there.',
    header,
  ];
  const mark = (entry: Entry) =>
    `; ${entry.from}${entry.note ? `: ${entry.note}` : ''}`;

  for (const entry of entries) {
    if (entry.kind === 'field') {
      out.push(`  ${entry.text}  ${mark(entry)}`);
      continue;
    }

    const indent = /^\s*/.exec(entry.text[0])![0].length;
    const lines = entry.text.map(
      (line) =>
        '  ' + line.slice(Math.min(indent, /^\s*/.exec(line)![0].length)),
    );

    lines[0] = `${lines[0]}  ${mark(entry)}`;
    out.push(...lines);
  }
  out.push('End', '');
  return out.join('\n');
};
