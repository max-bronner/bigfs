import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/**
 * Two languages' tables in the workspace: the check finds what German
 * lacks and fills it into the German table with the English text.
 * Everything is synthetic.
 */

suite('Translations check', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'translations',
    );
    await mkdir(path.join(folder, 'english'), { recursive: true });
    await mkdir(path.join(folder, 'german'), { recursive: true });
    await writeFile(
      path.join(folder, 'english', 'mod.str'),
      'OBJECT:TransRanger\n"Ranger"\nEND\n\nOBJECT:TransArcher\n"Archer"\nEND\n',
    );
    await writeFile(
      path.join(folder, 'german', 'mod.str'),
      'OBJECT:TransArcher\n"Bogenschuetze"\nEND\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('finds what German lacks and fills it with the English text', async function () {
    this.timeout(30_000);

    const gaps = await vscode.commands.executeCommand<
      { language: string; missing: { label: string }[] }[]
    >('bigfs.checkTranslations', { fill: ['german'] });
    const german = gaps.find((gap) => gap.language === 'german');

    assert.ok(
      german?.missing.some((entry) => entry.label === 'OBJECT:TransRanger'),
    );
    const table = await vscode.workspace.openTextDocument(
      path.join(folder, 'german', 'mod.str'),
    );

    assert.match(table.getText(), /OBJECT:TransRanger\r?\n"Ranger"\r?\nEND/);
  });
});
