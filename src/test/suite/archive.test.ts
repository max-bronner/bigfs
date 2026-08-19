import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { unlink, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../format/bigFormat';
import type { BigFileEntry } from '../../format/bigFormat';

const ARCHIVE_NAME = 'generated.big';

/**
 * Builds a complete archive, so the tests run against real bytes on disk
 * rather than a fixture that has to be kept in the repository
 */
const buildArchive = (files: { name: string; content: string }[]): Buffer => {
  const entries = new Map<string, BigFileEntry>();

  for (const { name, content } of files) {
    const pendingData = Buffer.from(content, 'utf-8');

    entries.set(name, {
      name,
      offset: 0,
      size: pendingData.length,
      pendingData,
    });
  }

  const layout = computeArchiveLayout(entries);
  const indexTable = serializeIndexTable('BIGF', layout);
  const archive = Buffer.alloc(layout.totalSize);

  indexTable.copy(archive, 0);

  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(archive, offset);
  }

  return archive;
};

const nodeUri = (nodePath: string): vscode.Uri =>
  vscode.Uri.from({ scheme: 'bigfs', path: nodePath });

const readText = async (nodePath: string): Promise<string> => {
  const content = await vscode.workspace.fs.readFile(nodeUri(nodePath));

  return Buffer.from(content).toString('utf-8');
};

const readNames = async (nodePath: string): Promise<string[]> => {
  const entries = await vscode.workspace.fs.readDirectory(nodeUri(nodePath));

  return entries.map(([name]) => name).sort();
};

/**
 * Retries until the check passes, for the steps that wait on the watcher
 */
const waitFor = async (check: () => Thenable<unknown>): Promise<void> => {
  const timeoutAt = Date.now() + 15_000;

  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > timeoutAt) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

suite('BIG archive file system', () => {
  let archiveFsPath: string;

  const writeArchiveToDisk = async (
    files: { name: string; content: string }[],
  ): Promise<void> => {
    await writeFile(archiveFsPath, buildArchive(files));
  };

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    assert.ok(workspaceFolder, 'the test workspace must be open');

    archiveFsPath = path.join(workspaceFolder.uri.fsPath, ARCHIVE_NAME);

    await writeArchiveToDisk([
      { name: 'Data/INI/Object.ini', content: 'ObjectData' },
      { name: 'readme.txt', content: 'Top level' },
    ]);

    // The watcher picks the new archive up asynchronously
    await waitFor(() => vscode.workspace.fs.stat(nodeUri(`/${ARCHIVE_NAME}`)));
  });

  suiteTeardown(async () => {
    await unlink(archiveFsPath).catch(() => undefined);
  });

  test('lists the archive content', async () => {
    const entries = await vscode.workspace.fs.readDirectory(
      nodeUri(`/${ARCHIVE_NAME}`),
    );

    assert.deepStrictEqual(
      new Map(entries),
      new Map([
        ['Data', vscode.FileType.Directory],
        ['readme.txt', vscode.FileType.File],
      ]),
    );
  });

  test('reports a file size without reading its content', async () => {
    const { type, size } = await vscode.workspace.fs.stat(
      nodeUri(`/${ARCHIVE_NAME}/readme.txt`),
    );

    assert.strictEqual(type, vscode.FileType.File);
    assert.strictEqual(size, 'Top level'.length);
  });

  test('reads content from a nested entry', async () => {
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/INI/Object.ini`),
      'ObjectData',
    );
  });

  test('writes a new file and keeps the existing entries', async () => {
    await vscode.workspace.fs.writeFile(
      nodeUri(`/${ARCHIVE_NAME}/Data/new.txt`),
      Buffer.from('created', 'utf-8'),
    );

    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/new.txt`),
      'created',
    );
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/INI/Object.ini`),
      'ObjectData',
    );
  });

  test('keeps a directory that has nothing stored below it', async () => {
    await vscode.workspace.fs.createDirectory(
      nodeUri(`/${ARCHIVE_NAME}/Data/Empty`),
    );

    const { type } = await vscode.workspace.fs.stat(
      nodeUri(`/${ARCHIVE_NAME}/Data/Empty`),
    );

    assert.strictEqual(type, vscode.FileType.Directory);
  });

  test('renames a file', async () => {
    await vscode.workspace.fs.rename(
      nodeUri(`/${ARCHIVE_NAME}/Data/new.txt`),
      nodeUri(`/${ARCHIVE_NAME}/Data/renamed.txt`),
    );

    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/renamed.txt`),
      'created',
    );

    await assert.rejects(async () => {
      await readText(`/${ARCHIVE_NAME}/Data/new.txt`);
    });
  });

  test('renames a directory with everything below it', async () => {
    await vscode.workspace.fs.rename(
      nodeUri(`/${ARCHIVE_NAME}/Data/INI`),
      nodeUri(`/${ARCHIVE_NAME}/Data/Rules`),
    );

    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/Rules/Object.ini`),
      'ObjectData',
    );
  });

  test('refuses to write below an existing file', async () => {
    await assert.rejects(async () => {
      await vscode.workspace.fs.writeFile(
        nodeUri(`/${ARCHIVE_NAME}/readme.txt/nested.txt`),
        Buffer.from('x', 'utf-8'),
      );
    });

    // The archive is left untouched by the refusal
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/readme.txt`),
      'Top level',
    );
  });

  test('deletes a directory with everything below it', async () => {
    await vscode.workspace.fs.delete(nodeUri(`/${ARCHIVE_NAME}/Data/Rules`), {
      recursive: true,
    });

    assert.ok(!(await readNames(`/${ARCHIVE_NAME}/Data`)).includes('Rules'));

    // The entries outside the deleted directory survive
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/Data/renamed.txt`),
      'created',
    );
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/readme.txt`),
      'Top level',
    );
  });

  test('picks up an archive rewritten outside the editor', async () => {
    await writeArchiveToDisk([
      { name: 'Data/external.txt', content: 'FromDisk' },
    ]);

    await waitFor(async () => {
      assert.strictEqual(
        await readText(`/${ARCHIVE_NAME}/Data/external.txt`),
        'FromDisk',
      );
    });

    assert.deepStrictEqual(await readNames(`/${ARCHIVE_NAME}`), ['Data']);
  });
});
