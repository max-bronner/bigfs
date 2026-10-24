import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** Missing models, textures and sounds reported in the editor, with fixes */
suite('INI asset checks', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'assetcheck',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'checkbody.w3d'), 'w3d');
    await writeFile(path.join(folder, 'checkicon.dds'), 'dds');
    await vscode.workspace
      .getConfiguration()
      .update(
        'bigfs.ini.checkAssets',
        'on',
        vscode.ConfigurationTarget.Workspace,
      );
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration()
      .update(
        'bigfs.ini.checkAssets',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('a name no file matches is reported, with the near one as a fix', async function () {
    this.timeout(30_000);

    const file = path.join(folder, 'checks.ini');

    await writeFile(
      file,
      [
        'Object CheckUnit',
        '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
        '    DefaultModelConditionState',
        '      Model = CheckBody',
        '    End',
        '    ConditionState = DAMAGED',
        '      Model = CheckBodx',
        '    End',
        '  End',
        'End',
        'MappedImage CheckIcon',
        '  Texture = CheckIcon.tga',
        'End',
        '',
      ].join('\r\n'),
    );

    const document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(file),
      'sage-ini',
    );

    await vscode.window.showTextDocument(document);

    const missing = await (async () => {
      const until = Date.now() + 20_000;

      for (;;) {
        const found = vscode.languages
          .getDiagnostics(document.uri)
          .filter((diagnostic) => / has no /.test(diagnostic.message));

        if (found.length || Date.now() > until) {
          return found;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })();

    assert.deepStrictEqual(
      missing.map((diagnostic) => [
        diagnostic.range.start.line,
        diagnostic.message,
      ]),
      [
        [
          6,
          "Model 'CheckBodx' has no checkbodx.w3d in any archive or folder; did you mean 'checkbody'?",
        ],
      ],
    );

    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      missing[0].range,
    );
    const change = actions.find(
      (action) => action.title === "Change to 'checkbody'",
    );

    assert.ok(change?.edit, 'no fix offered');
    await vscode.workspace.applyEdit(change.edit);
    assert.strictEqual(document.lineAt(6).text, '      Model = checkbody');
  });
});
