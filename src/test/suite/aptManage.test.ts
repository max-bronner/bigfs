import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';

/**
 * A movie handled as a whole: renamed with every file it has, and the
 * movies importing it following the new name; then deleted with every
 * file. Everything is synthetic.
 */

const listFiles = async (folder: string): Promise<string[]> =>
  (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();

suite('APT movies as a whole', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'aptmanage',
    );
    await mkdir(path.join(folder, 'MgmtLib_geometry'), { recursive: true });
    await mkdir(path.join(folder, 'art', 'textures'), { recursive: true });

    const lib = createAptMovie({ width: 10, height: 10, exports: ['Panel'] });

    await writeFile(path.join(folder, 'MgmtLib.apt'), lib.apt);
    await writeFile(path.join(folder, 'MgmtLib.const'), lib.constFile);
    await writeFile(path.join(folder, 'MgmtLib.dat'), lib.dat);
    await writeFile(path.join(folder, 'MgmtLib_geometry', '9.ru'), 'c\n');
    await writeFile(
      path.join(folder, 'art', 'textures', 'apt_mgmtlib_3.tga'),
      'x',
    );

    // The root movie imports Panel from it
    const root = createAptMovie({ width: 10, height: 10, exports: [] });
    const image = new AptImage(root.apt);

    applyAptEdit(image, parseConst(root.constFile).movieOffset, {
      kind: 'addImport',
      movie: 'MgmtLib',
      name: 'Panel',
    });
    await writeFile(path.join(folder, 'MgmtRoot.apt'), image.bytes);
    await writeFile(path.join(folder, 'MgmtRoot.const'), root.constFile);
    await writeFile(path.join(folder, 'MgmtRoot.dat'), root.dat);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('a rename moves every file, and the importing movie follows', async function () {
    this.timeout(60_000);

    const renamed = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.renameAptMovie',
      vscode.Uri.file(path.join(folder, 'MgmtLib.apt')),
      'MgmtNew',
    );

    assert.strictEqual(path.basename(renamed.fsPath), 'MgmtNew.apt');
    assert.deepStrictEqual(await listFiles(folder), [
      'MgmtNew.apt',
      'MgmtNew.const',
      'MgmtNew.dat',
      'MgmtNew_geometry/9.ru',
      'MgmtRoot.apt',
      'MgmtRoot.const',
      'MgmtRoot.dat',
      'art/textures/apt_mgmtnew_3.tga',
    ]);

    const root = parseAptMovie(
      new Uint8Array(await readFile(path.join(folder, 'MgmtRoot.apt'))),
      parseConst(await readFile(path.join(folder, 'MgmtRoot.const')))
        .movieOffset,
    );

    assert.strictEqual(root.imports[0].movie, 'MgmtNew');
  });

  test('a delete removes every file of the movie and nothing else', async function () {
    this.timeout(30_000);

    assert.strictEqual(
      await vscode.commands.executeCommand<boolean>(
        'bigfs.deleteAptMovie',
        vscode.Uri.file(path.join(folder, 'MgmtNew.apt')),
        true,
      ),
      true,
    );
    assert.deepStrictEqual(await listFiles(folder), [
      'MgmtRoot.apt',
      'MgmtRoot.const',
      'MgmtRoot.dat',
    ]);
  });
});
