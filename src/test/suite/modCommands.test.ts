import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { readArchiveIndexTable } from '../../node/archiveFile';
import { ArchiveModel } from '../../model/archiveModel';
import { packFolderInto } from '../../commands/modCommands';

suite('Mod commands', () => {
  let folder: string;
  let archivePath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  suiteSetup(async function () {
    this.timeout(30_000);

    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;

    folder = path.join(root, 'packme');
    archivePath = path.join(root, 'packme.big');

    await mkdir(path.join(folder, 'data', 'ini'), { recursive: true });
    await writeFile(
      path.join(folder, 'data', 'ini', 'unit.ini'),
      'Object GondorFighter\r\n  KindOf = INFANTRY\r\nEnd\r\n',
    );
    await writeFile(path.join(folder, 'readme.txt'), 'packed');

    log = vscode.window.createOutputChannel('bigFS mod tests', { log: true });
    model = new ArchiveModel(log);
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await rm(folder, { recursive: true, force: true });
    await rm(archivePath, { force: true });
  });

  test('packs a folder into a BIG4 archive the way shipped ones are laid out', async () => {
    const count = await packFolderInto(
      vscode.Uri.file(folder),
      vscode.Uri.file(archivePath),
    );
    const { magic, trailer, entries } =
      await readArchiveIndexTable(archivePath);
    const bytes = await readFile(archivePath);

    assert.strictEqual(count, 2);
    assert.strictEqual(magic, 'BIG4');
    assert.strictEqual(Buffer.from(trailer).toString('latin1', 0, 4), 'L219');
    assert.deepStrictEqual(entries.map((entry) => entry.storedName).sort(), [
      'data\\ini\\unit.ini',
      'readme.txt',
    ]);
    assert.ok(bytes.includes(Buffer.from('KindOf = INFANTRY')));
  });
});
