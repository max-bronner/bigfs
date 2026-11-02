import * as assert from 'assert';
import type { Uri } from 'vscode';
import { createSageIniTables } from '../../services/ini/sageIniTables';
import type { FileEntries } from '../../formats/ini/sageIniEntries';

const uriOf = (path: string): Uri => ({ path }) as unknown as Uri;

const entries = (parts: Partial<FileEntries> = {}): FileEntries => ({
  definitions: [],
  references: [],
  macros: [],
  constantUses: [],
  bodyTokens: [],
  ...parts,
});

const definition = (name: string, line = 0) => ({
  namespace: 'Weapon',
  keyword: 'Weapon',
  name,
  line,
  endLine: line + 1,
  start: 7,
  end: 7 + name.length,
});

const reference = (name: string, line = 0) => ({
  namespace: 'Weapon',
  name,
  line,
  start: 0,
  end: name.length,
  field: 'Weapon',
});

const pathsOf = (places: readonly { uri: Uri }[] | undefined): string[] =>
  (places ?? []).map(({ uri }) => uri.path);

suite('SAGE INI index tables', () => {
  test('a file read again replaces what it wrote, so a changed file leaves nothing stale', () => {
    const tables = createSageIniTables();
    const uri = uriOf('/mod/data/ini/weapon.ini');

    tables.replaceFile(
      uri,
      entries({
        definitions: [definition('Sword')],
        references: [reference('Bow')],
      }),
    );
    tables.replaceFile(
      uri,
      entries({
        definitions: [definition('Axe')],
        references: [reference('Spear')],
      }),
    );

    assert.strictEqual(tables.definitions.get('weapon')?.has('sword'), false);
    assert.strictEqual(tables.definitions.get('weapon')?.get('axe')?.length, 1);
    assert.strictEqual(tables.references.get('weapon')?.has('bow'), false);
    assert.strictEqual(tables.references.get('weapon')?.get('spear')?.length, 1);
  });

  test('dropping one file keeps what other files wrote under the same name, in order', () => {
    const tables = createSageIniTables();

    tables.replaceFile(
      uriOf('/mod/a.ini'),
      entries({ definitions: [definition('Sword')] }),
    );
    tables.replaceFile(
      uriOf('/mod/b.ini'),
      entries({ definitions: [definition('Sword')] }),
    );
    tables.replaceFile(
      uriOf('/mod/c.ini'),
      entries({ definitions: [definition('Sword')] }),
    );
    tables.replaceFile(
      uriOf('/mod/b.ini'),
      entries({ definitions: [definition('Sword')] }),
    );

    assert.deepStrictEqual(
      pathsOf(tables.definitions.get('weapon')?.get('sword')),
      ['/mod/a.ini', '/mod/c.ini', '/mod/b.ini'],
    );
  });

  test('purging an archive drops every file below it and no other', () => {
    const tables = createSageIniTables();

    tables.replaceFile(
      uriOf('/base/INI.big/data/ini/a.ini'),
      entries({
        definitions: [definition('Sword')],
        constantUses: [
          { key: 'yes', line: 0, start: 0, end: 3, field: 'Flag' },
        ],
      }),
    );
    tables.replaceFile(
      uriOf('/base/ini.big/data/ini/b.ini'),
      entries({ references: [reference('Sword')] }),
    );
    tables.replaceFile(
      uriOf('/base/Other.big/data/ini/c.ini'),
      entries({
        definitions: [definition('Sword')],
        constantUses: [
          { key: 'yes', line: 0, start: 0, end: 3, field: 'Flag' },
        ],
      }),
    );

    tables.purge('/base/ini.big');

    assert.deepStrictEqual(
      pathsOf(tables.definitions.get('weapon')?.get('sword')),
      ['/base/Other.big/data/ini/c.ini'],
    );
    assert.strictEqual(tables.references.get('weapon')?.has('sword'), false);
    assert.deepStrictEqual(pathsOf(tables.constantUses.get('yes')), [
      '/base/Other.big/data/ini/c.ini',
    ]);
  });

  test('a macro a later file redefined survives the purge of the file that first wrote it', () => {
    const tables = createSageIniTables();
    const macro = (value: string) => ({
      name: 'SPEED',
      value,
      line: 0,
      start: 8,
      end: 13,
    });

    tables.replaceFile(uriOf('/m/a.ini'), entries({ macros: [macro('1')] }));
    tables.replaceFile(uriOf('/m/b.ini'), entries({ macros: [macro('2')] }));
    tables.purge('/m/a.ini');

    assert.strictEqual(tables.macros.get('speed')?.value, '2');

    tables.purge('/m/b.ini');

    assert.strictEqual(tables.macros.has('speed'), false);
  });

  test('a string table read again does not double its records', () => {
    const tables = createSageIniTables();
    const uri = uriOf('/lang/English.big/data/english/lotr.str');
    const records = new Map([
      ['object:sword', { label: 'OBJECT:Sword', text: 'Sword', line: 0 }],
    ]);

    tables.replaceStrings(uri, records, 'English');
    tables.replaceStrings(uri, records, 'English');

    assert.strictEqual(tables.strings.get('object:sword')?.length, 1);
    assert.strictEqual(tables.strings.get('object:sword')?.[0].language, 'English');
  });

  test('clear empties every table', () => {
    const tables = createSageIniTables();

    tables.replaceFile(
      uriOf('/m/a.ini'),
      entries({ definitions: [definition('Sword')] }),
    );
    tables.clear();
    tables.replaceFile(
      uriOf('/m/a.ini'),
      entries({ definitions: [definition('Axe')] }),
    );

    assert.strictEqual(tables.definitions.get('weapon')?.size, 1);
  });
});
