import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** The armor table reads armors through the index and writes cells back */
suite('Armor table', () => {
  let folder: string;
  let file: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'armortable',
    );
    file = path.join(folder, 'armor.ini');
    await mkdir(folder, { recursive: true });
    await writeFile(
      file,
      'Armor TableArmorA\n  Armor = DEFAULT 100%\n  Armor = CRUSH 50%\nEnd\n\nArmor TableArmorB\n  Armor = DEFAULT 80%\nEnd\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('a cell edits its line, or adds one the armor lacks', async function () {
    this.timeout(40_000);

    type Table = { types: string[]; rows: { name: string }[] };
    const until = Date.now() + 30_000;
    let table: Table | undefined;

    // The index reads the new file through its watcher
    while (
      !table?.rows.some((row) => row.name === 'TableArmorB') &&
      Date.now() < until
    ) {
      table = await vscode.commands.executeCommand<Table>(
        'bigfs.showArmorTable',
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.ok(table?.types.includes('CRUSH'));

    await vscode.commands.executeCommand('bigfs.showArmorTable', {
      kind: 'set',
      armor: 'TableArmorA',
      type: 'CRUSH',
      value: '40',
    });
    await vscode.commands.executeCommand('bigfs.showArmorTable', {
      kind: 'set',
      armor: 'TableArmorB',
      type: 'CRUSH',
      value: '25%',
    });

    const text = (await vscode.workspace.openTextDocument(file))
      .getText()
      .replace(/\r\n/g, '\n');

    assert.strictEqual(
      text,
      'Armor TableArmorA\n  Armor = DEFAULT 100%\n  Armor = CRUSH 40%\nEnd\n\nArmor TableArmorB\n  Armor = DEFAULT 80%\n  Armor = CRUSH 25%\nEnd\n',
    );
  });
});
