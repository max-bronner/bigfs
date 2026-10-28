import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm } from 'fs/promises';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';

/**
 * The text view of a loose movie: it opens as `apt-text`, saving it
 * unchanged leaves the files byte for byte, an edit reaches the movie, and
 * a text that does not parse is refused with the movie untouched.
 */

const replaceText = async (document: vscode.TextDocument, text: string) => {
  const edit = new vscode.WorkspaceEdit();

  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    text,
  );
  await vscode.workspace.applyEdit(edit);
};

suite('APT text view', () => {
  let folder: string;
  let movieUri: vscode.Uri;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'apttext',
    );
    await mkdir(folder, { recursive: true });
    movieUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      vscode.Uri.file(folder),
      { name: 'TextFlow', exports: ['Panel'] },
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('saving the text writes only what was edited', async function () {
    this.timeout(30_000);

    const before = new Uint8Array(await readFile(movieUri.fsPath));
    const textUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.openAptText',
      movieUri,
    );
    const text = await vscode.workspace.openTextDocument(textUri);

    assert.strictEqual(text.languageId, 'apt-text');
    assert.match(text.getText(), /^character 1 sprite$/m);

    // Unchanged: nothing is written
    await replaceText(text, `${text.getText()}\n; a note\n`);
    assert.ok(await text.save());
    assert.deepStrictEqual(
      new Uint8Array(await readFile(movieUri.fsPath)),
      before,
    );

    await replaceText(
      text,
      text.getText().replace(/screen=\d+x\d+/, 'screen=640x480'),
    );
    assert.ok(await text.save());

    const apt = new Uint8Array(await readFile(movieUri.fsPath));
    const constFile = parseConst(
      await readFile(movieUri.fsPath.replace(/\.apt$/, '.const')),
    );

    assert.strictEqual(apt.length, before.length);
    assert.deepStrictEqual(
      [
        parseAptMovie(apt, constFile.movieOffset).record.screenWidth,
        parseAptMovie(apt, constFile.movieOffset).record.screenHeight,
      ],
      [640, 480],
    );
  });

  test('a text that does not parse is underlined and not saved', async function () {
    this.timeout(30_000);

    const before = new Uint8Array(await readFile(movieUri.fsPath));
    const text = await vscode.workspace.openTextDocument(
      await vscode.commands.executeCommand<vscode.Uri>(
        'bigfs.openAptText',
        movieUri,
      ),
    );

    await replaceText(
      text,
      text.getText().replace('character 1 sprite', 'character 1 sprite x'),
    );

    for (let tries = 0; tries < 50; tries++) {
      if (vscode.languages.getDiagnostics(text.uri).length) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      vscode.languages.getDiagnostics(text.uri).length,
      'the problem was not underlined',
    );
    assert.strictEqual(await text.save(), false);
    assert.deepStrictEqual(
      new Uint8Array(await readFile(movieUri.fsPath)),
      before,
    );
    await vscode.commands.executeCommand('workbench.action.revertFile');
  });

  test('symbols outline the characters and their frames', async () => {
    const text = await vscode.workspace.openTextDocument(
      await vscode.commands.executeCommand<vscode.Uri>(
        'bigfs.openAptText',
        movieUri,
      ),
    );
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >('vscode.executeDocumentSymbolProvider', text.uri);

    assert.ok(symbols.some((symbol) => symbol.name === '1 sprite'));
    assert.deepStrictEqual(
      symbols
        .find((symbol) => symbol.name === '0 movie')
        ?.children.map((child) => child.name),
      ['frame 0'],
    );
  });
});
