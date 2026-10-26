import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/**
 * A W3D file finds the INI lines that use it, and an animation the model
 * an object plays it on. Everything is synthetic.
 */

const waitFor = async (check: () => Promise<void>, limit = 20_000) => {
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

suite('W3D file uses', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'fileuses',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'unit.ini'),
      [
        'Object UsesTestUnit',
        '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
        '    DefaultModelConditionState',
        '      Model = UTU_SKN',
        '    End',
        '    AnimationState = MOVING',
        '      Animation = Run',
        '        AnimationName = UTU_SKL.UTU_RUNA',
        '      End',
        '    End',
        '  End',
        'End',
        '',
      ].join('\n'),
    );
  });

  suiteTeardown(() => rm(folder, { recursive: true, force: true }));

  test('lists the lines naming a model, and the model an animation plays on', async function () {
    this.timeout(40_000);

    await waitFor(async () => {
      const uses = await vscode.commands.executeCommand<
        { line: number; field: string; owner?: string }[]
      >('bigfs.findFileUses', 'utu_skn.w3d');

      assert.deepStrictEqual(
        uses.map(({ line, field, owner }) => [line, field, owner]),
        [[3, 'model', 'Object UsesTestUnit']],
      );
    });
    assert.strictEqual(
      await vscode.commands.executeCommand(
        'bigfs.findModelForAnimation',
        'utu_runa.w3d',
      ),
      'UTU_SKN',
    );
  });
});
