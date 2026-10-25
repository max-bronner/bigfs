import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/**
 * The effective view of a ChildObject whose parent sits in another file:
 * found through the index, composed, and redrawn when the parent changes.
 * Everything is synthetic.
 */

const waitFor = async (check: () => void | Promise<void>, limit = 20_000) => {
  const timeoutAt = Date.now() + limit;

  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > timeoutAt) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

suite('Effective definitions', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'effective',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'parent.ini'),
      'Object EffectiveParent\n  Side = Testland\n  BuildCost = 100\nEnd\n',
    );
    await writeFile(
      path.join(folder, 'child.ini'),
      'ChildObject EffectiveChild EffectiveParent\n  BuildCost = 150\nEnd\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('composes the child over a parent found in another file', async function () {
    this.timeout(40_000);

    await waitFor(async () => {
      const view = await vscode.commands.executeCommand<vscode.TextDocument>(
        'bigfs.showEffectiveObject',
        vscode.Uri.file(path.join(folder, 'child.ini')),
        0,
      );

      assert.ok(view);
      assert.match(view.getText(), /Side = Testland {2}; EffectiveParent\n/);
      assert.match(
        view.getText(),
        /BuildCost = 150 {2}; EffectiveChild: was 100 in EffectiveParent\n/,
      );
    });
  });
});
