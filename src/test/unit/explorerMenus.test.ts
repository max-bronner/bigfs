import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { getContextValue } from '../../features/explorer/rowContext';
import type { RowContextKind } from '../../features/explorer/rowContext';

interface MenuItem {
  command: string;
  when?: string;
}

const manifest = JSON.parse(
  readFileSync(path.join(__dirname, '../../../package.json'), 'utf-8'),
) as { contributes: { menus: Record<string, MenuItem[]> } };

/**
 * Evaluates the subset of `when` clause syntax the explorer menus use: `&&`
 * of `key`, `!key`, `key == value`, `key != value` and `key =~ /pattern/flags`
 */
const evaluate = (when: string, context: Record<string, unknown>): boolean =>
  when.split('&&').every((atom) => {
    const text = atom.trim();
    const match = /^(\S+)\s*(==|!=|=~)\s*(.+)$/.exec(text);

    if (!match) {
      return text.startsWith('!') ? !context[text.slice(1)] : Boolean(context[text]);
    }

    const [, key, operator, operand] = match;
    const value = String(context[key] ?? '');

    if (operator === '=~') {
      const [, pattern, flags] = /^\/(.*)\/([a-z]*)$/.exec(operand) ?? [];

      return new RegExp(pattern, flags).test(value);
    }

    return (value === operand) === (operator === '==');
  });

/** The commands the explorer's item menu offers on a row of this kind */
const menuFor = (
  kind: RowContextKind,
  isReadOnly: boolean,
  resourceExtname = '',
): Set<string> =>
  new Set(
    manifest.contributes.menus['view/item/context']
      .filter((item) =>
        evaluate(item.when ?? 'true', {
          view: 'bigArchiveExplorer',
          viewItem: getContextValue(kind, isReadOnly),
          resourceExtname,
          'bigfs.hasClipboard': true,
        }),
      )
      .map((item) => item.command),
  );

const EDITS = [
  'bigfs.newFile',
  'bigfs.newFolder',
  'bigfs.addFiles',
  'bigfs.paste',
  'bigfs.cut',
  'bigfs.duplicate',
  'bigfs.rename',
  'bigfs.delete',
];

const hasAll = (menu: Set<string>, commands: string[]): void =>
  commands.forEach((command) => assert.ok(menu.has(command), `${command} is missing`));

const hasNone = (menu: Set<string>, commands: string[]): void =>
  commands.forEach((command) => assert.ok(!menu.has(command), `${command} must not show`));

suite('Explorer menus', () => {
  test('a source and a folder on disk offer a new archive, and only when writable', () => {
    for (const kind of ['source', 'diskFolder'] as const) {
      hasAll(menuFor(kind, false), ['bigfs.newArchive']);
      hasNone(menuFor(kind, true), ['bigfs.newArchive']);
      hasNone(menuFor(kind, false), EDITS);
    }
  });

  test('a writable archive offers new files and folders, adding, pasting, renaming and deleting', () => {
    const menu = menuFor('archive', false);

    hasAll(menu, [
      'bigfs.newFile',
      'bigfs.newFolder',
      'bigfs.addFiles',
      'bigfs.paste',
      'bigfs.extract',
      'bigfs.rename',
      'bigfs.delete',
      'bigfs.copyPath',
    ]);
    hasNone(menu, ['bigfs.cut', 'bigfs.duplicate']);
  });

  test('a writable folder and file offer every edit that fits them', () => {
    hasAll(menuFor('folder', false), [...EDITS, 'bigfs.extract', 'bigfs.copy', 'bigfs.copyPath']);
    hasAll(menuFor('file', false), [
      'bigfs.cut',
      'bigfs.copy',
      'bigfs.duplicate',
      'bigfs.rename',
      'bigfs.delete',
      'bigfs.extract',
    ]);
    hasNone(menuFor('file', false), ['bigfs.newFile', 'bigfs.paste', 'bigfs.addFiles']);
  });

  test('a read-only row keeps everything that only reads', () => {
    for (const kind of ['archive', 'folder', 'file'] as const) {
      const menu = menuFor(kind, true);

      hasAll(menu, ['bigfs.extract', 'bigfs.copyPath']);
      hasNone(menu, EDITS);
    }

    hasAll(menuFor('folder', true), ['bigfs.copy', 'bigfs.overrideInFolder']);
    hasAll(menuFor('file', true), ['bigfs.copy', 'bigfs.overrideInFolder']);
  });

  test('a game view folder can be extracted and overridden', () => {
    hasAll(menuFor('gameFolder', false), ['bigfs.extract', 'bigfs.overrideInFolder']);
    hasNone(menuFor('gameFolder', false), EDITS);
  });

  test('a read-only row still hides the converters that write', () => {
    hasNone(menuFor('file', true, '.png'), ['bigfs.convertPng']);
    hasAll(menuFor('file', false, '.png'), ['bigfs.convertPng']);
  });

  test('every command a menu names is contributed', () => {
    const contributed = new Set(
      (
        manifest as unknown as { contributes: { commands: { command: string }[] } }
      ).contributes.commands.map((entry) => entry.command),
    );

    for (const item of manifest.contributes.menus['view/item/context']) {
      assert.ok(contributed.has(item.command), item.command);
    }
  });
});
