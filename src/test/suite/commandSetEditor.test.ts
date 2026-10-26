import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** The CommandSet editor reads a set's buttons and writes moves back */
suite('CommandSet editor', () => {
  let folder: string;
  let file: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'commandsetedit',
    );
    file = path.join(folder, 'sets.ini');
    await mkdir(folder, { recursive: true });
    await writeFile(
      file,
      [
        'CommandButton EditTestA',
        '  Command = UNIT_BUILD',
        'End',
        '',
        'CommandButton EditTestB',
        '  Command = UPGRADE',
        'End',
        '',
        'CommandSet EditTestSet',
        '  1 = EditTestA',
        '  2 = EditTestB',
        'End',
        '',
      ].join('\n'),
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('shows the buttons and writes a move as the slot lines', async function () {
    this.timeout(40_000);

    const uri = vscode.Uri.file(file);
    const until = Date.now() + 30_000;
    let set:
      | { slots: { slot: number; defined: boolean; command?: string }[] }
      | undefined;

    // The index reads the new file through its watcher
    while (!set?.slots.every((slot) => slot.defined) && Date.now() < until) {
      set = await vscode.commands.executeCommand(
        'bigfs.editCommandSet',
        uri,
        'EditTestSet',
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.deepStrictEqual(
      set?.slots.map((slot) => [slot.slot, slot.command]),
      [
        [1, 'UNIT_BUILD'],
        [2, 'UPGRADE'],
      ],
    );

    await vscode.commands.executeCommand(
      'bigfs.editCommandSet',
      uri,
      'EditTestSet',
      {
        kind: 'move',
        from: 1,
        to: 4,
      },
    );
    assert.match(
      (await vscode.workspace.openTextDocument(uri)).getText(),
      /CommandSet EditTestSet\r?\n {2}2 = EditTestB\r?\n {2}4 = EditTestA\r?\nEnd/,
    );
  });
});
