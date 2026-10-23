import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { computeArchiveLayout, serializeIndexTable } from '../../binary/bigFormat';
import type { BigFileEntry } from '../../binary/bigFormat';
import { SAGE_INI_LANGUAGE } from '../../constants';

/**
 * Exercises the language providers the way the editor does, through the
 * `vscode.execute*Provider` commands. This is the only place the providers are
 * proved end to end: the unit tests cover the parser and the schema, but not
 * that a provider is registered, reachable, and returns what the editor needs.
 */

const ARCHIVE_NAME = 'language.big';

/** Defines the names the other entry references, so a jump has a target */
const WEAPONS_INI = [
  '#define SHROUD_CLEAR_STANDARD 25',
  '',
  'Weapon GondorBowWeapon',
  '  AttackRange = 200',
  'End',
  '',
  'Upgrade Upgrade_FireArrows',
  '  DisplayName = UPGRADE:FireArrows',
  'End',
].join('\r\n');

/** Includes reaching out of its own directory, one hit and one miss */
const CHILD_INC = [
  String.raw`#include "..\weapon.ini"`,
  String.raw`#include "..\Missing.inc"`,
].join('\r\n');

/** References into the other entry, which is the cross-file case */
const OBJECT_INI = [
  'Object GondorArcher',
  '  Body = ActiveBody ModuleTag_02',
  '    MaxHealth = 100',
  '  End',
  '  WeaponSet',
  '    Weapon = PRIMARY GondorBowWeapon',
  '  End',
  '  Behavior = CostModifierUpgrade ModuleTag_07',
  '    TriggeredBy = Upgrade_FireArrows',
  '  End',
  '  Armor = DEFAULT 100%',
  '  ShroudClearingRange = SHROUD_CLEAR_STANDARD',
  'End',
].join('\r\n');

const buildArchive = (files: { name: string; content: string }[]): Buffer => {
  const entries = new Map<string, BigFileEntry>();

  for (const { name, content } of files) {
    const pendingData = Buffer.from(content, 'utf-8');

    entries.set(name, { name, offset: 0, size: pendingData.length, pendingData });
  }

  const layout = computeArchiveLayout(entries);
  const indexTable = serializeIndexTable('BIGF', layout);
  const archive = Buffer.alloc(layout.totalSize);

  indexTable.copy(archive, 0);

  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(archive, offset);
  }

  return archive;
};

const entryUri = (entryPath: string): vscode.Uri => {
  const source = vscode.workspace.workspaceFolders![0].name.toLowerCase();

  return vscode.Uri.from({
    scheme: 'bigfs',
    path: `/${source}/${ARCHIVE_NAME}/${entryPath}`,
  });
};

suite('SAGE INI language', () => {
  let archiveFsPath: string;
  let objectDocument: vscode.TextDocument;

  suiteSetup(async function () {
    this.timeout(60000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0];

    archiveFsPath = path.join(workspaceFolder.uri.fsPath, ARCHIVE_NAME);

    await fs.writeFile(
      archiveFsPath,
      buildArchive([
        { name: 'data\\ini\\weapon.ini', content: WEAPONS_INI },
        { name: 'data\\ini\\object.ini', content: OBJECT_INI },
        { name: 'data\\ini\\sub\\child.inc', content: CHILD_INC },
        {
          name: 'data\\lotr.str',
          content: 'UPGRADE:FireArrows\r\n"Fire Arrows"\r\nEND\r\n',
        },
      ]),
    );

    await vscode.commands.executeCommand('bigfs.refreshArchives');

    objectDocument = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );
  });

  suiteTeardown(async () => {
    await fs.rm(archiveFsPath, { force: true });
  });

  test('an .ini entry inside an archive is recognised as the dialect', async () => {
    // The manifest does not claim .ini, so this proves the content check runs
    await vscode.window.showTextDocument(objectDocument);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const reopened = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );

    assert.strictEqual(reopened.languageId, SAGE_INI_LANGUAGE);
  });

  test('the outline nests modules under the object that holds them', async () => {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >('vscode.executeDocumentSymbolProvider', objectDocument.uri);

    assert.ok(symbols?.length, 'the outline must not be empty');

    const [object] = symbols;

    assert.strictEqual(object.name, 'GondorArcher');
    assert.strictEqual(object.detail, 'Object');

    // ActiveBody is a module; Armor = DEFAULT 100% is a leaf and must not appear
    const names = object.children.map((child) => child.name);

    assert.ok(names.includes('ActiveBody'), `modules missing from ${names}`);
    assert.ok(!names.includes('Armor'), 'a leaf field must not be a symbol');
  });

  test('folding covers each block from its header to its End', async () => {
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      'vscode.executeFoldingRangeProvider',
      objectDocument.uri,
    );

    assert.ok(ranges?.length, 'there must be folding ranges');
    assert.ok(
      ranges.some((range) => range.start === 0 && range.end === 12),
      'the Object must fold from its header to its End',
    );
  });

  test('hover says whether the engine defines a field', async () => {
    // MaxHealth is on line 2, at "MaxHealth"
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      objectDocument.uri,
      new vscode.Position(2, 6),
    );

    const text = hovers
      .flatMap((hover) => hover.contents)
      .map((content) =>
        typeof content === 'string' ? content : (content as vscode.MarkdownString).value,
      )
      .join('\n');

    assert.match(text, /MaxHealth/);
    assert.match(text, /Engine defined/i);
  });

  test('go to definition follows a reference into another entry', async () => {
    // Weapon = PRIMARY GondorBowWeapon, on line 5
    const line = objectDocument.lineAt(5).text;
    const character = line.indexOf('GondorBowWeapon') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      objectDocument.uri,
      new vscode.Position(5, character),
    );

    assert.ok(links?.length, 'the reference must resolve');

    const [target] = links;

    assert.ok(
      target.targetUri.path.endsWith('weapon.ini'),
      `expected weapon.ini, got ${target.targetUri.path}`,
    );
    assert.strictEqual(
      target.targetSelectionRange!.start.line,
      2,
      'Weapon GondorBowWeapon follows the #define',
    );
    // The target range spans the whole block, which is what makes the
    // ctrl-hover preview show the definition rather than one line of it
    assert.strictEqual(target.targetRange.start.line, 2);
    assert.strictEqual(target.targetRange.end.line, 4, 'through its End');
    // The origin range covers just the value, so the underline is exact
    assert.strictEqual(
      objectDocument.getText(target.originSelectionRange),
      'GondorBowWeapon',
    );
  });

  test('go to definition resolves an upgrade named in a behavior', async () => {
    const line = objectDocument.lineAt(8).text;
    const character = line.indexOf('Upgrade_FireArrows') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      objectDocument.uri,
      new vscode.Position(8, character),
    );

    assert.ok(links?.length, 'TriggeredBy must resolve into Upgrade');
    assert.ok(links[0].targetUri.path.endsWith('weapon.ini'));
    assert.strictEqual(links[0].targetSelectionRange!.start.line, 6);
    assert.strictEqual(links[0].targetRange.end.line, 8, 'through its End');
  });

  test('a value that references nothing offers no definition', async () => {
    // Armor = DEFAULT 100% is a damage multiplier, not a name
    const line = objectDocument.lineAt(10).text;
    const character = line.indexOf('DEFAULT') + 2;

    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      objectDocument.uri,
      new vscode.Position(10, character),
    );

    assert.strictEqual(locations?.length ?? 0, 0);
  });
  test('find references works from the declaration outwards', async () => {
    // Weapon GondorBowWeapon is line 0 of weapon.ini
    const weaponDocument = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );
    const line = weaponDocument.lineAt(2).text;
    const character = line.indexOf('GondorBowWeapon') + 2;

    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      weaponDocument.uri,
      new vscode.Position(2, character),
    );

    assert.ok(locations?.length, 'the declaration must have a use');

    const use = locations.find((location) =>
      location.uri.path.endsWith('object.ini'),
    );

    assert.ok(use, `expected a use in object.ini, got ${locations.map((l) => l.uri.path)}`);
    assert.strictEqual(use.range.start.line, 5, 'the WeaponSet line');
    // The range covers the value, not the whole line, so the peek highlights it
    assert.strictEqual(
      objectDocument.getText(use.range),
      'GondorBowWeapon',
    );
  });

  test('find references works from a use as well as a declaration', async () => {
    const line = objectDocument.lineAt(8).text;
    const character = line.indexOf('Upgrade_FireArrows') + 2;

    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      objectDocument.uri,
      new vscode.Position(8, character),
    );

    assert.ok(locations?.length, 'a use must find the other uses');
    assert.ok(
      locations.some(
        (location) =>
          location.uri.path.endsWith('object.ini') &&
          location.range.start.line === 8,
      ),
      'the use under the cursor is itself a reference',
    );
  });

suite('SAGE INI navigation behaviour', () => {
  test('a single definition returns one link, so ctrl-click jumps', async () => {
    // More than one result makes VS Code peek instead of jumping, so the
    // count matters as much as the target
    const document = await vscode.workspace.openTextDocument(entryUri('data/ini/object.ini'));
    const character = document.lineAt(5).text.indexOf('GondorBowWeapon') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(5, character),
    );

    assert.strictEqual(links.length, 1, 'exactly one target keeps it a jump');
  });

  test('on a declaration the definition is itself, which is what makes VS Code show references', async () => {
    const document = await vscode.workspace.openTextDocument(entryUri('data/ini/weapon.ini'));
    const character = document.lineAt(2).text.indexOf('GondorBowWeapon') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(2, character),
    );

    assert.strictEqual(links.length, 1);
    assert.ok(links[0].targetUri.path.endsWith('weapon.ini'));
    assert.strictEqual(links[0].targetSelectionRange!.start.line, 2);
  });
});

suite('SAGE INI completion', () => {
  const complete = async (
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<string[]> => {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      uri,
      position,
    );

    return list.items.map((item) =>
      typeof item.label === 'string' ? item.label : item.label.label,
    );
  };

  test('completes the fields legal inside a module, not every module field', async () => {
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );

    // Line 2 is MaxHealth inside Body = ActiveBody
    const labels = await complete(document.uri, new vscode.Position(2, 4));

    assert.ok(labels.includes('MaxHealth'), `ActiveBody fields missing: ${labels.slice(0, 10)}`);
    // DestructionDelay belongs to SlowDeathBehavior, not to ActiveBody
    assert.ok(
      !labels.includes('DestructionDelay'),
      'a field from another module must not be offered',
    );
  });

  test('completes module types after a slot keyword', async () => {
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );
    const line = document.lineAt(1).text;
    const character = line.indexOf('ActiveBody') + 4;

    const labels = await complete(document.uri, new vscode.Position(1, character));

    assert.ok(labels.includes('ActiveBody'), `Body module types missing: ${labels.slice(0, 10)}`);
    assert.ok(labels.length > 1, 'a slot has several types');
  });

  test('completes definition names on a reference field', async () => {
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );
    const line = document.lineAt(8).text;
    const character = line.indexOf('Upgrade_FireArrows') + 4;

    const labels = await complete(document.uri, new vscode.Position(8, character));

    assert.ok(
      labels.includes('Upgrade_FireArrows'),
      `upgrade names missing: ${labels.slice(0, 10)}`,
    );
  });

  test('completes root blocks at file scope', async () => {
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );

    // Line 5 is blank, between the two root blocks
    const labels = await complete(document.uri, new vscode.Position(5, 0));

    assert.ok(labels.includes('Object'), `root blocks missing: ${labels.slice(0, 10)}`);
    assert.ok(labels.includes('Weapon'));
  });
});

suite('SAGE INI macros', () => {
  test('a macro resolves to its #define in another entry', async () => {
    // SHROUD_CLEAR_STANDARD is a #define in weapon.ini, used from object.ini.
    // Nothing about the value says it is a macro rather than a block name.
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );
    const line = document.lineAt(11).text;
    const character = line.indexOf('SHROUD_CLEAR_STANDARD') + 4;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(11, character),
    );

    assert.strictEqual(links.length, 1, 'the macro must resolve');
    assert.ok(links[0].targetUri.path.endsWith('weapon.ini'));
    assert.strictEqual(links[0].targetSelectionRange!.start.line, 0);
  });

  test('hover on a macro shows what it expands to', async () => {
    const document = await vscode.workspace.openTextDocument(
      entryUri('data/ini/object.ini'),
    );
    const line = document.lineAt(11).text;
    const character = line.indexOf('SHROUD_CLEAR_STANDARD') + 4;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(11, character),
    );

    const text = hovers
      .flatMap((hover) => hover.contents)
      .map((content) =>
        typeof content === 'string'
          ? content
          : (content as vscode.MarkdownString).value,
      )
      .join('\n');

    assert.match(text, /macro/i);
    assert.match(text, /25/, 'the expansion must be shown');
  });
});

suite('SAGE INI references include the declaration', () => {
  test('find references returns the declaration alongside the uses', async () => {
    const weapon = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );
    const character = weapon.lineAt(2).text.indexOf('GondorBowWeapon') + 2;

    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      weapon.uri,
      new vscode.Position(2, character),
    );

    const at = (name: string, line: number) =>
      locations.some(
        (l) => l.uri.path.endsWith(name) && l.range.start.line === line,
      );

    assert.ok(at('object.ini', 5), 'the use must be listed');
    assert.ok(at('weapon.ini', 2), 'the declaration must be listed too');
  });

  test('find references on a macro finds its uses, which are not namespace references', async () => {
    const weapon = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );
    const character = weapon.lineAt(0).text.indexOf('SHROUD_CLEAR_STANDARD') + 4;

    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      weapon.uri,
      new vscode.Position(0, character),
    );

    assert.ok(
      locations.some(
        (l) => l.uri.path.endsWith('object.ini') && l.range.start.line === 11,
      ),
      `the macro use must be found, got ${locations.map((l) => `${l.uri.path.split('/').pop()}:${l.range.start.line}`)}`,
    );
  });
});

suite('SAGE INI includes', () => {
  test('an include path resolves to the entry it names', async () => {
    // ..\weapon.ini from data/ini/sub/child.inc resolves to data/ini/weapon.ini
    const child = await vscode.workspace.openTextDocument(
      entryUri('data/ini/sub/child.inc'),
    );
    const line = child.lineAt(0).text;
    const character = line.indexOf('weapon.ini') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      child.uri,
      new vscode.Position(0, character),
    );

    assert.ok(links?.length, 'the include must resolve');
    assert.ok(
      links[0].targetUri.path.endsWith('data/ini/weapon.ini'),
      `expected data/ini/weapon.ini, got ${links[0].targetUri.path}`,
    );
    // The link covers the path, not the whole directive
    assert.strictEqual(
      child.getText(links[0].originSelectionRange),
      String.raw`..\weapon.ini`,
    );
  });

  test('an include of a file that is not there offers nothing', async () => {
    const child = await vscode.workspace.openTextDocument(
      entryUri('data/ini/sub/child.inc'),
    );
    const line = child.lineAt(1).text;
    const character = line.indexOf('Missing.inc') + 2;

    const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      child.uri,
      new vscode.Position(1, character),
    );

    assert.strictEqual(links?.length ?? 0, 0);
  });
});

  test('hover on a string label shows the text the game displays', async () => {
    const weaponDocument = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );
    const character = weaponDocument.lineAt(7).text.indexOf('FireArrows');

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      weaponDocument.uri,
      new vscode.Position(7, character),
    );
    const text = hovers
      .flatMap((hover) => hover.contents)
      .map((content) => (typeof content === 'string' ? content : content.value))
      .join('\n')
      // Plain text in a hover has its spaces escaped for markdown
      .replace(/&nbsp;/g, ' ');

    assert.ok(text.includes('Fire Arrows'), `expected the game text, got ${text}`);
  });

  test('rename edits the declaration and every use, in every entry', async () => {
    const weaponDocument = await vscode.workspace.openTextDocument(
      entryUri('data/ini/weapon.ini'),
    );
    const character = weaponDocument.lineAt(2).text.indexOf('GondorBowWeapon');

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      weaponDocument.uri,
      new vscode.Position(2, character + 2),
      'GondorLongbow',
    );
    const edited = edit
      .entries()
      .map(([uri, edits]) => [uri.path.split('/').pop(), edits.length]);

    assert.deepStrictEqual(
      edited.sort(),
      [
        ['object.ini', 1],
        ['weapon.ini', 1],
      ],
    );
  });

  test('a missing include is reported in the Problems panel', async () => {
    const child = await vscode.workspace.openTextDocument(
      entryUri('data/ini/sub/child.inc'),
    );
    const timeoutAt = Date.now() + 10_000;
    let messages: string[] = [];

    while (Date.now() < timeoutAt) {
      messages = vscode.languages
        .getDiagnostics(child.uri)
        .map((diagnostic) => diagnostic.message);

      if (messages.length) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    assert.deepStrictEqual(messages, [
      'Included file not found: ..\\Missing.inc',
    ]);
  });
});
