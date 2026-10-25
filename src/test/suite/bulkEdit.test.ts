import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';

/**
 * A bulk edit over the workspace, run without its preview: only the values
 * the blocks, conditions and field pick change, in place, as one undoable
 * edit. Everything is synthetic.
 */

const TEXT = [
  'Object BulkTestArcher',
  '  Side = Bulkland',
  '  BuildCost = 120 ; cost',
  '  Body = ActiveBody ModuleTag_Body',
  '    MaxHealth = 200',
  '  End',
  'End',
  '',
  'Object BulkTestKnight',
  '  Side = Elsewhere',
  '  BuildCost = 300',
  'End',
  '',
].join('\n');

suite('INI bulk edit', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'bulkedit',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'bulk.ini'), TEXT);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('changes only the picked values, keeping the rest of each line', async function () {
    this.timeout(30_000);

    const changed = await vscode.commands.executeCommand<number>(
      'bigfs.bulkEditIni',
      {
        blocks: 'Object BulkTest*',
        where: 'Side = Bulkland',
        field: 'BuildCost',
        formula: 'round(x * 1.25)',
        confirm: false,
      },
    );

    assert.strictEqual(changed, 1);

    const document = await vscode.workspace.openTextDocument(
      path.join(folder, 'bulk.ini'),
    );

    assert.strictEqual(
      document.getText(),
      TEXT.replace('BuildCost = 120 ; cost', 'BuildCost = 150 ; cost'),
    );
    await document.save();
    assert.match(
      await readFile(path.join(folder, 'bulk.ini'), 'utf8'),
      /BuildCost = 150 ; cost/,
    );
  });
});
