import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';

/** Duplicating a definition, with its own copy of its game text */
suite('Duplicate definition', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'duplicate',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'dup.str'),
      'OBJECT:DupTester\r\n"Tester"\r\nEND\r\n',
    );
    await writeFile(
      path.join(folder, 'dup.ini'),
      'Object DupTester\r\n  DisplayName = OBJECT:DupTester\r\n  BuildCost = 300\r\nEnd\r\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('copies the block below and its text into the string table', async function () {
    this.timeout(40_000);

    const document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(path.join(folder, 'dup.ini')),
      'sage-ini',
    );
    const until = Date.now() + 30_000;
    let result: { labels: string[] } | undefined;

    // The string table is found through the index, which reads files once
    for (;;) {
      result = await vscode.commands.executeCommand<{ labels: string[] }>(
        'bigfs.duplicateDefinition',
        document.uri,
        1,
        'DupTesterElite',
      );
      if (result?.labels.length || Date.now() > until) {
        break;
      }
      await vscode.commands.executeCommand('undo');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    assert.deepStrictEqual(result?.labels, ['OBJECT:DupTesterElite']);
    assert.strictEqual(
      document.getText(),
      'Object DupTester\r\n  DisplayName = OBJECT:DupTester\r\n  BuildCost = 300\r\nEnd\r\n' +
        'Object DupTesterElite\r\n  DisplayName = OBJECT:DupTesterElite\r\n  BuildCost = 300\r\nEnd\r\n',
    );

    const table = vscode.workspace.textDocuments.find((open) =>
      open.uri.fsPath.endsWith('dup.str'),
    )!;

    assert.strictEqual(
      table.getText(),
      'OBJECT:DupTester\r\n"Tester"\r\nEND\r\nOBJECT:DupTesterElite\r\n"Tester"\r\nEND\r\n',
    );
    assert.ok(await readFile(path.join(folder, 'dup.str'), 'latin1'));
  });
});
