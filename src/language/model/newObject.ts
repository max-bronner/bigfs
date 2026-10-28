import { duplicateDefinition, renameLabels } from './duplicateDefinition';
import type { LabelRename } from './duplicateDefinition';
import { stripComment, tokenize } from '../../formats/ini/sageIniParser';

/**
 * The text a new unit, hero or building is made of, planned from an
 * existing one: the object itself (a `ChildObject` that inherits, or a full
 * copy), the button that builds it, and its slot in a command set. Pure:
 * the command reads the files, this decides the lines.
 */

export type NewObjectMode = 'inherit' | 'copy';

export interface PlannedBlock {
  lines: string[];
  /** Game-text labels the copy renamed, to give their own records */
  labels: LabelRename[];
}

/** The label a new object's name is shown by */
export const displayLabel = (name: string) => `OBJECT:${name}`;

/**
 * Sets a field written at a block's own level, or adds it under the
 * header, keeping the indentation the block uses
 */
export const setField = (
  lines: string[],
  keyword: string,
  value: string,
): string[] => {
  // The block's own level is where its first line sits
  const first = lines.slice(1, -1).find((line) => line.trim() !== '');
  const own = (first && /^\s*/.exec(first)![0]) || '  ';
  const at = lines.findIndex(
    (line, index) =>
      index > 0 &&
      line.startsWith(own) &&
      !/^\s/.test(line.slice(own.length)) &&
      tokenize(stripComment(line))[0]?.text.toLowerCase() ===
        keyword.toLowerCase(),
  );
  const written = `${own}${keyword} = ${value}`;

  return at >= 0
    ? lines.map((line, index) => (index === at ? written : line))
    : [lines[0], written, ...lines.slice(1)];
};

/** A `ChildObject` that inherits everything and is shown under its own name */
export const inheritingObject = (
  name: string,
  parent: string,
): PlannedBlock => ({
  lines: [
    `ChildObject ${name} ${parent}`,
    `  DisplayName = ${displayLabel(name)}`,
    `  ; Write what differs from ${parent} here: a field replaces the`,
    '  ; inherited one, a module replaces the one with its tag',
    'End',
  ],
  labels: [],
});

/** A full copy of the source block under the new name, shown by its own label */
export const copiedObject = (
  lines: string[],
  startLine: number,
  endLine: number,
  name: string,
): PlannedBlock => {
  const copy = duplicateDefinition(lines, startLine, endLine, name);

  return {
    lines: setField(copy.lines, 'DisplayName', displayLabel(name)),
    labels: copy.labels,
  };
};

/** The new button's name: the old one with the unit's name swapped, or suffixed */
export const buttonName = (
  button: string,
  source: string,
  name: string,
): string => {
  const at = button.toLowerCase().indexOf(source.toLowerCase());

  return at >= 0
    ? button.slice(0, at) + name + button.slice(at + source.length)
    : `${button}_${name}`;
};

/** A copy of the button that builds the source, building the new object */
export const copiedButton = (
  lines: string[],
  startLine: number,
  endLine: number,
  newButton: string,
  name: string,
): PlannedBlock => {
  const copy = duplicateDefinition(lines, startLine, endLine, newButton);
  // Its text names the unit it builds more often than the button
  const source = tokenize(stripComment(lines[startLine]))[1]?.text ?? '';
  const objectLine = copy.lines.find(
    (line) => tokenize(stripComment(line))[0]?.text.toLowerCase() === 'object',
  );
  const builds = objectLine
    ? tokenize(stripComment(objectLine))[1]?.text
    : undefined;
  const relabelled =
    builds && builds !== source
      ? renameLabels(copy.lines.slice(1), builds, name)
      : { lines: copy.lines.slice(1), labels: [] };

  return {
    lines: setField([copy.lines[0], ...relabelled.lines], 'Object', name),
    labels: [...copy.labels, ...relabelled.labels],
  };
};

/**
 * The line that puts a button in a command set's next free slot, and the
 * line it goes before (the set's `End`)
 */
export const slotLine = (
  setLines: string[],
  button: string,
): { line: number; text: string } => {
  let highest = 0;
  let indent = '  ';

  for (const line of setLines.slice(1, -1)) {
    const [slot] = tokenize(stripComment(line));

    if (slot && /^\d+$/.test(slot.text)) {
      highest = Math.max(highest, Number(slot.text));
      indent = /^\s*/.exec(line)![0];
    }
  }
  return {
    line: setLines.length - 1,
    text: `${indent}${highest + 1} = ${button}`,
  };
};

/**
 * The folder whose `.ini` files the game loads object definitions from: the
 * `Data\INI\Object` directory is read file by file, subfolders included,
 * while an `.ini` anywhere else is read only when the boot legend names it
 * and an `.inc` only when an `#include` pulls it in
 */
export const OBJECT_FOLDER = 'data/ini/object';

/** Whether the game reads the entry at an archive-relative path for its objects */
export const isLoadedObjectPath = (entryPath: string): boolean =>
  /^data\/ini\/object\/(?:.+\/)?[^/]+\.ini$/i.test(
    entryPath.replace(/\\/g, '/'),
  );

/**
 * The entry a new object is written to: beside its source when that file is
 * one the game loads, else a file of its own in the object folder, which a
 * file at the root of a mod or in a folder the game never reads is not
 */
export const newObjectEntryPath = (
  sourceEntryPath: string | undefined,
  name: string,
): string =>
  sourceEntryPath && isLoadedObjectPath(sourceEntryPath)
    ? sourceEntryPath.replace(/\\/g, '/')
    : `${OBJECT_FOLDER}/${name}.ini`;
