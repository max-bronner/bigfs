import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { encodeTga } from '../../formats/textureEncode';

/** The CommandSet hover: slots in order, each with its icon and game text */
suite('CommandSet hover', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'cmdset',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'cmdicon.tga'),
      encodeTga(
        { width: 8, height: 8, pixels: new Uint8Array(256).fill(200) },
        true,
      ),
    );
    await writeFile(
      path.join(folder, 'cmdtest.str'),
      'CONTROLBAR:CmdTest\r\n"Train Tester"\r\nEND\r\n',
    );
    await writeFile(
      path.join(folder, 'cmdset.ini'),
      [
        'MappedImage CmdIcon',
        '  Texture = cmdicon.tga',
        '  TextureWidth = 8',
        '  TextureHeight = 8',
        '  Coords = Left:0 Top:0 Right:8 Bottom:8',
        '  Status = NONE',
        'End',
        'CommandButton Command_CmdTest',
        '  Command = UNIT_BUILD',
        '  ButtonImage = CmdIcon',
        '  TextLabel = CONTROLBAR:CmdTest',
        'End',
        'CommandSet CmdTestSet',
        '  1 = Command_CmdTest',
        '  2 = Command_CmdMissing',
        'End',
        '',
      ].join('\r\n'),
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('shows each slot with its icon, its text and what is missing', async function () {
    this.timeout(40_000);

    const document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(path.join(folder, 'cmdset.ini')),
      'sage-ini',
    );
    const position = new vscode.Position(12, 14);
    const until = Date.now() + 30_000;
    let text = '';

    while (Date.now() < until) {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        position,
      );

      text = hovers
        .flatMap((hover) => hover.contents)
        .map((content) =>
          typeof content === 'string' ? content : content.value,
        )
        .join('\n');
      if (text.includes('Train Tester') && text.includes('data:image/png')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    assert.match(text, /CommandSet, 2 buttons/);
    assert.match(text, /\*\*1\*\* Train Tester/);
    assert.match(text, /data:image\/png;base64,/);
    assert.match(text, /\*\*2\*\*<br>Command\\_CmdMissing<br>\*not defined\*/);
  });
});
