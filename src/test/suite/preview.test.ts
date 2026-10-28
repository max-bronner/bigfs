import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { rm, writeFile } from 'fs/promises';
import { PREVIEW_VIEW_TYPE } from '../../providers/previewEditorProvider';
import { APT_VIEW_TYPE } from '../../features/apt/viewTypes';

suite('Previews', () => {
  let texturePath: string;

  suiteSetup(async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders![0];

    texturePath = path.join(workspaceFolder.uri.fsPath, 'preview.tga');

    // One red pixel, 24-bit, stored blue first
    await writeFile(
      texturePath,
      Uint8Array.from([
        0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0, 0, 0, 255,
      ]),
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(texturePath, { force: true });
  });

  test('a TGA opens in the preview by default', async () => {
    await vscode.commands.executeCommand(
      'vscode.open',
      vscode.Uri.file(texturePath),
    );

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

    assert.ok(
      input instanceof vscode.TabInputCustom,
      'expected a custom editor',
    );
    assert.strictEqual(input.viewType, PREVIEW_VIEW_TYPE);
  });

  test('a W3D model opens in the preview too, even one it cannot draw', async () => {
    const modelPath = path.join(path.dirname(texturePath), 'preview.w3d');

    await writeFile(modelPath, new Uint8Array(4));

    try {
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.file(modelPath),
      );

      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

      assert.ok(
        input instanceof vscode.TabInputCustom,
        'expected a custom editor',
      );
      assert.strictEqual(input.viewType, PREVIEW_VIEW_TYPE);
    } finally {
      await rm(modelPath, { force: true });
    }
  });

  test('an APT movie opens in the movie inspector', async () => {
    const moviePath = path.join(path.dirname(texturePath), 'preview.apt');

    await writeFile(moviePath, new Uint8Array(16));

    try {
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.file(moviePath),
      );

      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

      assert.ok(input instanceof vscode.TabInputCustom);
      assert.strictEqual(input.viewType, APT_VIEW_TYPE);
    } finally {
      await rm(moviePath, { force: true });
    }
  });
});
