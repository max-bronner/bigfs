import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { createAptMovie } from '../../formats/apt/aptCreate';

/**
 * Integrity in the editor and across the workspace: a new movie reports
 * nothing; a file beside it that nothing uses is a warning once the movie
 * is drawn again; a movie without its `.const`, never opened, is found by
 * the workspace check. Everything is synthetic.
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

const messages = (uri: vscode.Uri) =>
  vscode.languages.getDiagnostics(uri).map((each) => each.message);

suite('APT integrity', () => {
  let folder: string;
  let movieUri: vscode.Uri;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'aptintegrity',
    );
    await mkdir(folder, { recursive: true });
    movieUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      vscode.Uri.file(folder),
      { name: 'Sound', exports: ['Panel'] },
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

  test('a new movie holds together; a stray geometry file is a warning', async function () {
    this.timeout(30_000);

    assert.deepStrictEqual(messages(movieUri), []);

    await mkdir(path.join(folder, 'Sound_geometry'), { recursive: true });
    await writeFile(path.join(folder, 'Sound_geometry', '99.ru'), 'c\n');
    await vscode.commands.executeCommand('bigfs.aptApplyEdit', movieUri, {
      kind: 'screen',
      width: 800,
      height: 600,
    });
    await waitFor(() =>
      assert.deepStrictEqual(messages(movieUri), [
        'Sound_geometry/99.ru belongs to no shape',
      ]),
    );
  });

  test('the workspace check finds a movie without its .const', async function () {
    this.timeout(60_000);

    const broken = path.join(folder, 'Broken.apt');

    await writeFile(
      broken,
      createAptMovie({ width: 10, height: 10, exports: [] }).apt,
    );
    await vscode.commands.executeCommand('bigfs.checkAptMovies');
    await waitFor(() =>
      assert.deepStrictEqual(messages(vscode.Uri.file(broken)), [
        'Broken.const is missing: the movie cannot be loaded',
      ]),
    );
  });
});
