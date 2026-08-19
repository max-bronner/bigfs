import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, unlink, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../format/bigFormat';
import type { BigFileEntry } from '../../format/bigFormat';
import { ArchiveModel } from '../../model/archiveModel';
import {
  BigTreeDataProvider,
  BigTreeItem,
} from '../../providers/treeDataProvider';
import { findChild, getFileNodes } from '../../model/virtualNode';
import type { VirtualNode } from '../../model/virtualNode';

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

  test('resolves entries whose casing does not match', async () => {
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME.toUpperCase()}/data/ini/OBJECT.INI`),
      'ObjectData',
    );
  });

  test('lists entries with the casing they are stored with', async () => {
    assert.deepStrictEqual(await readNames(`/${ARCHIVE_NAME}/Data/INI`), [
      'Object.ini',
    ]);
  });

  test('renames an entry to a different casing', async () => {
    await vscode.workspace.fs.rename(
      nodeUri(`/${ARCHIVE_NAME}/readme.txt`),
      nodeUri(`/${ARCHIVE_NAME}/README.TXT`),
    );

    assert.ok((await readNames(`/${ARCHIVE_NAME}`)).includes('README.TXT'));
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/README.TXT`),
      'Top level',
    );

    await vscode.workspace.fs.rename(
      nodeUri(`/${ARCHIVE_NAME}/README.TXT`),
      nodeUri(`/${ARCHIVE_NAME}/readme.txt`),
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

  test('keeps archives that share a name apart', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const nestedDirectory = path.join(workspaceFolder, 'mods');
    const nestedPath = path.join(nestedDirectory, ARCHIVE_NAME);

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(
      nestedPath,
      buildArchive([{ name: 'readme.txt', content: 'From the mods folder' }]),
    );

    try {
      await waitFor(() =>
        vscode.workspace.fs.stat(nodeUri(`/mods/${ARCHIVE_NAME}/readme.txt`)),
      );

      // Each archive keeps its own content under its own path
      assert.strictEqual(
        await readText(`/mods/${ARCHIVE_NAME}/readme.txt`),
        'From the mods folder',
      );
      assert.strictEqual(
        await readText(`/${ARCHIVE_NAME}/readme.txt`),
        'Top level',
      );

      // The nested archive holds nothing the top level one has
      await assert.rejects(async () => {
        await readText(`/mods/${ARCHIVE_NAME}/Data/renamed.txt`);
      });
    } finally {
      await rm(nestedDirectory, { recursive: true, force: true });
    }
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

suite('Tree refresh', () => {
  const REFRESH_ARCHIVE = 'refresh.big';

  let archiveFsPath: string;
  let nestedDirectory: string;
  let nestedFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  const treeItem = (node: VirtualNode): BigTreeItem =>
    new BigTreeItem(node, vscode.TreeItemCollapsibleState.Collapsed);

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0];

    archiveFsPath = path.join(workspaceFolder.uri.fsPath, REFRESH_ARCHIVE);
    nestedDirectory = path.join(workspaceFolder.uri.fsPath, 'nested');
    nestedFsPath = path.join(nestedDirectory, REFRESH_ARCHIVE);

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(
      nestedFsPath,
      buildArchive([{ name: 'inside.txt', content: 'Nested' }]),
    );

    await writeFile(
      archiveFsPath,
      buildArchive([
        { name: 'a.txt', content: 'A' },
        { name: 'data/one.txt', content: '1' },
        { name: 'data/two.txt', content: '2' },
      ]),
    );

    log = vscode.window.createOutputChannel('bigFS tests', { log: true });
    model = new ArchiveModel(log);

    await model.whenReady();
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await unlink(archiveFsPath).catch(() => undefined);
    await rm(nestedDirectory, { recursive: true, force: true });
  });

  test('marks an archive below a directory as an archive', () => {
    const nested = model.getArchiveByPath(nestedFsPath);

    assert.ok(nested, 'the nested archive was not loaded');

    // The root sits at /nested/refresh.big, which is not /refresh.big
    assert.strictEqual(treeItem(nested.root).contextValue, 'bigArchive');
    assert.strictEqual(
      treeItem(model.getArchiveByPath(archiveFsPath)!.root).contextValue,
      'bigArchive',
    );
  });

  test('counts the files below a folder', () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const folder = findChild(archive.root, 'data');

    assert.ok(folder, 'the folder is missing');
    assert.strictEqual(treeItem(folder).contextValue, 'bigFolder');
    assert.strictEqual(treeItem(folder).description, '(2 files)');
  });

  test('refreshes the archive that changed instead of the whole view', async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const provider = new BigTreeDataProvider(model);
    const refreshed: (VirtualNode | undefined | void)[] = [];
    const subscription = provider.onDidChangeTreeData((element) =>
      refreshed.push(element),
    );

    const rootBefore = archive.root;

    await model.writeFile(
      nodeUri(`/${REFRESH_ARCHIVE}/b.txt`),
      Buffer.from('B', 'utf-8'),
    );

    subscription.dispose();

    // The tree view holds on to the root it was handed, so rebuilding the
    // tree has to keep it rather than replace it
    assert.strictEqual(archive.root, rootBefore);
    assert.deepStrictEqual(refreshed, [rootBefore]);
  });
});

suite('Bulk transfers', () => {
  const BULK_ARCHIVE = 'bulk.big';
  const IMPORTED_CONTENT = 'Streamed from disk';

  let archiveFsPath: string;
  let importFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  const readEntry = async (entryPath: string): Promise<string> => {
    const node = model.getNode(nodeUri(`/${BULK_ARCHIVE}/${entryPath}`));

    assert.ok(node, `${entryPath} is missing`);

    const content = await model.getFileContent(node);

    return Buffer.from(content!).toString('utf-8');
  };

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;

    archiveFsPath = path.join(workspaceFolder, BULK_ARCHIVE);
    importFsPath = path.join(workspaceFolder, 'source.txt');

    await writeFile(
      archiveFsPath,
      buildArchive([
        { name: 'a.txt', content: 'A' },
        { name: 'nested/b.txt', content: 'B' },
      ]),
    );
    await writeFile(importFsPath, Buffer.from(IMPORTED_CONTENT, 'utf-8'));

    log = vscode.window.createOutputChannel('bigFS bulk tests', { log: true });
    model = new ArchiveModel(log);

    await model.whenReady();
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await unlink(archiveFsPath).catch(() => undefined);
    await unlink(importFsPath).catch(() => undefined);
  });

  test('adds a file by copying it out of the file on disk', async () => {
    await model.addFiles(nodeUri(`/${BULK_ARCHIVE}`), [
      {
        name: 'imported.txt',
        size: IMPORTED_CONTENT.length,
        sourcePath: importFsPath,
      },
    ]);

    assert.strictEqual(await readEntry('imported.txt'), IMPORTED_CONTENT);

    // The entries already in the archive come through the rewrite intact
    assert.strictEqual(await readEntry('a.txt'), 'A');
    assert.strictEqual(await readEntry('nested/b.txt'), 'B');
  });

  test('reads several entries through one open archive', async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const items = getFileNodes(archive.root).map((node) => ({ node }));
    const read = new Map<string, string>();

    await model.readFiles(items, async (item, content) => {
      read.set(item.node.name, Buffer.from(content).toString('utf-8'));
    });

    assert.deepStrictEqual(
      read,
      new Map([
        ['a.txt', 'A'],
        ['b.txt', 'B'],
        ['imported.txt', IMPORTED_CONTENT],
      ]),
    );
  });
});
