import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** Two buttons of one CommandSet on the same key */
suite('Hotkey clashes', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'hotkeys',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'hotkeys.str'),
      [
        'CONTROLBAR:KeyTrain',
        '"&Train"',
        'END',
        'CONTROLBAR:KeyTower',
        '"&Tower"',
        'END',
        'CONTROLBAR:KeyBuild',
        '"&Build"',
        'END',
        '',
      ].join('\r\n'),
    );
    await writeFile(
      path.join(folder, 'hotkeys.ini'),
      [
        'CommandButton Command_KeyTrain',
        '  TextLabel = CONTROLBAR:KeyTrain',
        'End',
        'CommandButton Command_KeyTower',
        '  TextLabel = CONTROLBAR:KeyTower',
        'End',
        'CommandButton Command_KeyBuild',
        '  TextLabel = CONTROLBAR:KeyBuild',
        'End',
        'CommandSet KeyTestSet',
        '  1 = Command_KeyTrain',
        '  2 = Command_KeyBuild',
        '  3 = Command_KeyTower',
        'End',
        '',
      ].join('\r\n'),
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('both clashing slots are reported, the free one is not', async function () {
    this.timeout(40_000);

    const document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(path.join(folder, 'hotkeys.ini')),
      'sage-ini',
    );

    await vscode.window.showTextDocument(document);

    const until = Date.now() + 30_000;
    let clashes: [number, string][] = [];

    while (Date.now() < until) {
      clashes = vscode.languages
        .getDiagnostics(document.uri)
        .filter((diagnostic) => /^Hotkey/.test(diagnostic.message))
        .map((diagnostic) => [diagnostic.range.start.line, diagnostic.message]);
      if (clashes.length === 2) {
        break;
      }
      // Strings are indexed in the background; an edit asks for a recheck
      const edit = new vscode.WorkspaceEdit();

      edit.insert(document.uri, new vscode.Position(14, 0), ' ');
      await vscode.workspace.applyEdit(edit);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    assert.deepStrictEqual(
      clashes.sort((a, b) => a[0] - b[0]),
      [
        [10, "Hotkey 'T' is also used by slot 3 (Command_KeyTower)"],
        [12, "Hotkey 'T' is also used by slot 1 (Command_KeyTrain)"],
      ],
    );
  });
});
