import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { parseW3dAnimations } from '../../formats/w3dAnimation';
import { writeW3dAnimation } from '../../formats/w3dAnimationEdit';

/** An animation edited from the command, written beside the original */
suite('W3D animation edit', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'animedit',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'test_run.w3d'),
      writeW3dAnimation({
        name: 'TEST_RUN',
        hierarchyName: 'TEST_SKL',
        frameCount: 3,
        frameRate: 30,
        channels: [
          {
            pivot: 1,
            kind: 'x',
            type: 0,
            values: new Float32Array([0, 5, 10]),
            present: new Uint8Array([1, 1, 1]),
          },
        ],
      }),
    );
  });

  suiteTeardown(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  test('a reversed copy is written under its own name', async () => {
    const written = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.editW3dAnimation',
      vscode.Uri.file(path.join(folder, 'test_run.w3d')),
      { op: 'reverse' },
      'TEST_BACK',
    );
    const [animation] = parseW3dAnimations(await readFile(written.fsPath));

    assert.strictEqual(path.basename(written.fsPath), 'test_back.w3d');
    assert.strictEqual(animation.name, 'TEST_BACK');
    assert.deepStrictEqual(
      Array.from(animation.channels[0].values),
      [10, 5, 0],
    );
  });
});
