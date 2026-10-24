import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** Labels no string table defines, and the fix that adds them */
suite('Missing game text', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'strcheck',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'strcheck.str'),
      'OBJECT:StrCheckKnown\r\n"Known"\r\nEND\r\n',
    );
    await vscode.workspace
      .getConfiguration()
      .update(
        'bigfs.ini.checkStrings',
        'on',
        vscode.ConfigurationTarget.Workspace,
      );
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration()
      .update(
        'bigfs.ini.checkStrings',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('reports a label nothing defines and adds it to the table the file uses', async function () {
    this.timeout(40_000);

    const file = path.join(folder, 'strcheck.ini');

    await writeFile(
      file,
      'Object StrCheckUnit\r\n  DisplayName = OBJECT:StrCheckKnown\r\n  Description = OBJECT:StrCheckNewThing\r\nEnd\r\n',
    );

    const document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(file),
      'sage-ini',
    );

    await vscode.window.showTextDocument(document);

    const until = Date.now() + 30_000;
    let missing: vscode.Diagnostic[] = [];

    while (Date.now() < until) {
      missing = vscode.languages
        .getDiagnostics(document.uri)
        .filter((diagnostic) => /No game text/.test(diagnostic.message));
      // The known label is only resolved once the table is indexed
      if (missing.length === 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    assert.deepStrictEqual(
      missing.map((diagnostic) => diagnostic.message),
      ["No game text for 'OBJECT:StrCheckNewThing' in any string table"],
    );

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      missing[0].range,
    );
    const add = actions.find(
      (action) =>
        action.title === "Add 'OBJECT:StrCheckNewThing' to strcheck.str",
    );

    assert.ok(add?.edit, `no fix: ${actions.map((action) => action.title)}`);
    await vscode.workspace.applyEdit(add.edit);

    const table = vscode.workspace.textDocuments.find((open) =>
      open.uri.fsPath.endsWith('strcheck.str'),
    )!;

    assert.strictEqual(
      table.getText(),
      'OBJECT:StrCheckKnown\r\n"Known"\r\nEND\r\nOBJECT:StrCheckNewThing\r\n"Str Check New Thing"\r\nEND\r\n',
    );
  });
});
