import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm } from 'fs/promises';
import { readBehaviour } from '../../formats/apt/aptBehaviour';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';

/**
 * Scripts in their own tabs: a frame script is attached, written in its
 * tab and saved, and the movie runs what was written; a script that does
 * not compile is underlined and refuses to save. Everything is synthetic.
 */

const waitFor = async <T>(
  check: () => T | PromiseLike<T>,
  limit = 20_000,
): Promise<T> => {
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

const replaceText = async (document: vscode.TextDocument, text: string) => {
  const edit = new vscode.WorkspaceEdit();

  edit.replace(
    document.uri,
    new vscode.Range(0, 0, document.lineCount, 0),
    text,
  );
  await vscode.workspace.applyEdit(edit);
};

suite('APT script tabs', () => {
  let folder: string;
  let movieUri: vscode.Uri;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'aptscripts',
    );
    await mkdir(folder, { recursive: true });
    movieUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      vscode.Uri.file(folder),
      { name: 'ScriptFlow' },
    );
    await waitFor(async () => {
      const status = await vscode.commands.executeCommand<{
        pageReady: boolean;
      }>('bigfs.aptApplyEdit', movieUri);

      assert.ok(status.pageReady, 'the APT editor page did not load');
    });
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('a frame script written in its tab is what the saved movie runs', async function () {
    this.timeout(40_000);

    const scriptUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.aptAddScript',
      movieUri,
      { kind: 'frame', timeline: 0, frame: 0 },
      'ScriptFlow frame 0',
    );
    const script = await vscode.workspace.openTextDocument(scriptUri);

    assert.strictEqual(script.languageId, 'apt-script');
    await replaceText(script, 'gotoAndPlay("intro");\nstop();\n');
    assert.ok(await script.save(), 'the script did not save');

    // The movie is saved from its own editor, as a user would
    await vscode.commands.executeCommand(
      'vscode.openWith',
      movieUri,
      'bigfs.aptEditor',
    );
    await vscode.commands.executeCommand('workbench.action.files.save');

    const commands = await waitFor(async () => {
      const apt = new Uint8Array(await readFile(movieUri.fsPath));
      const constFile = parseConst(
        await readFile(movieUri.fsPath.replace(/\.apt$/, '.const')),
      );
      const action = parseAptMovie(
        apt,
        constFile.movieOffset,
      ).frames[0].items.find((item) => item.type === 'action');

      assert.ok(action?.type === 'action', 'no frame script was saved');
      return readBehaviour(apt, action.block, constFile.items).commands;
    });

    assert.deepStrictEqual(commands, [
      { op: 'goto', target: [], label: 'intro', play: true },
      { op: 'stop', target: [] },
    ]);
  });

  test('a script that does not compile is underlined and is not saved', async function () {
    this.timeout(30_000);

    const scriptUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.aptAddScript',
      movieUri,
      { kind: 'frame', timeline: 0, frame: 0 },
      'ScriptFlow broken',
    );
    const script = await vscode.workspace.openTextDocument(scriptUri);

    await replaceText(script, 'stop();\ngotoAndPlay("x"\n');
    await waitFor(() => {
      const [problem] = vscode.languages.getDiagnostics(scriptUri);

      assert.ok(problem, 'no problem was reported');
      assert.strictEqual(problem.range.start.line, 2);
    });
    assert.strictEqual(await script.save(), false);
  });
});
