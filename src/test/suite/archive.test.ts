import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../formats/big/bigFormat';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { ArchiveModel } from '../../services/archives/archiveModel';
import { BigTreeDataProvider } from '../../features/explorer/treeDataProvider';
import { findChild, getFileNodes } from '../../services/archives/virtualNode';
import { getExtractedFiles } from '../../features/explorer/extractCommands';
import type { VirtualNode } from '../../services/archives/virtualNode';
import { isVirtualNode } from '../../services/archives/explorerRow';

/** Names of a node's child rows, in the order the tree lists them */
const childNames = async (
  provider: BigTreeDataProvider,
  node: VirtualNode,
): Promise<string[]> => {
  const children = await provider.getChildren(node);

  return children.filter(isVirtualNode).map((child) => child.name);
};

const ARCHIVE_NAME = 'generated.big';

/**
 * Serializes files into the bytes of a whole archive. Real bytes, so the tests
 * need no fixture kept in the repository.
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

/**
 * Builds the uri for a node path inside the workspace source. A uri names its
 * source first, so the tests address entries the way the extension does rather
 * than assuming the workspace is the only place archives come from.
 */
const nodeUri = (nodePath: string): vscode.Uri => {
  const source = vscode.workspace.workspaceFolders![0].name.toLowerCase();

  return vscode.Uri.from({ scheme: 'bigfs', path: `/${source}${nodePath}` });
};

/** Reads an entry as text, through the file system provider */
const readText = async (nodePath: string): Promise<string> => {
  const content = await vscode.workspace.fs.readFile(nodeUri(nodePath));

  return Buffer.from(content).toString('utf-8');
};

/** Sorted names of a directory's rows, so a test never depends on read order */
const readNames = async (nodePath: string): Promise<string[]> => {
  const entries = await vscode.workspace.fs.readDirectory(nodeUri(nodePath));

  return entries.map(([name]) => name).sort();
};

/**
 * Retries a check until it passes, giving up after 15 seconds, for the steps
 * that wait on the watcher
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

  /** Replaces the suite's archive on disk, which the watcher then picks up */
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

  test('keeps archives that share a name apart', async function () {
    // Waits on the file watcher, which is slower than mocha's default
    this.timeout(20_000);

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

  test('picks up an archive rewritten outside the editor', async function () {
    // Waits on the file watcher, which is slower than mocha's default
    this.timeout(20_000);

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

  test('keeps a name stored in two casings through an unrelated save', async function () {
    // Waits on the file watcher, which is slower than mocha's default
    this.timeout(20_000);

    await writeArchiveToDisk([
      { name: 'Art/Textures/Unit.tga', content: 'first' },
      { name: 'art/textures/unit.tga', content: 'second' },
      { name: 'readme.txt', content: 'Top level' },
    ]);

    // The later entry is the one the engine reads, so it is the one shown
    await waitFor(async () => {
      assert.strictEqual(
        await readText(`/${ARCHIVE_NAME}/art/textures/unit.tga`),
        'second',
      );
    });

    await vscode.workspace.fs.writeFile(
      nodeUri(`/${ARCHIVE_NAME}/readme.txt`),
      Buffer.from('changed', 'utf-8'),
    );

    const written = await readFile(archiveFsPath);

    assert.strictEqual(written.readUInt32BE(8), 3);
    assert.strictEqual(
      await readText(`/${ARCHIVE_NAME}/art/textures/unit.tga`),
      'second',
    );
  });

  test('a save changes the mtime of the entry written and of no other', async () => {
    const stat = (nodePath: string) =>
      vscode.workspace.fs.stat(nodeUri(`/${ARCHIVE_NAME}/${nodePath}`));
    const otherBefore = await stat('art/textures/unit.tga');
    const writtenBefore = await stat('readme.txt');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await vscode.workspace.fs.writeFile(
      nodeUri(`/${ARCHIVE_NAME}/readme.txt`),
      Buffer.from('saved again', 'utf-8'),
    );

    assert.ok(writtenBefore.mtime > 0);
    assert.ok((await stat('readme.txt')).mtime > writtenBefore.mtime);
    assert.strictEqual(
      (await stat('art/textures/unit.tga')).mtime,
      otherBefore.mtime,
    );
  });
});

suite('Bulk transfers', () => {
  const BULK_ARCHIVE = 'bulk.big';
  const IMPORTED_CONTENT = 'Streamed from disk';

  let archiveFsPath: string;
  let importFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  /** Reads an entry through the model, so the assertions never go via a uri */
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

    // A file written moments ago may not be indexed yet, and an archive is
    // only read once something asks for its content
    await waitFor(async () => {
      const archive = model.getArchiveByPath(archiveFsPath);

      assert.ok(archive, 'the archive was not listed');

      await archive.ensureLoaded();
    });
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await unlink(archiveFsPath).catch(() => undefined);
    await unlink(importFsPath).catch(() => undefined);
  });

  test('adds a file by copying it out of the file on disk', async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    await model.addFiles(archive.root, [
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

suite('Extraction layout', () => {
  const LAYOUT_ARCHIVE = 'layout.big';

  let archiveFsPath: string;
  let strayFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  const targetDirectory = vscode.Uri.file(path.join('C:', 'out'));

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;

    archiveFsPath = path.join(workspaceFolder, LAYOUT_ARCHIVE);
    strayFsPath = path.join(workspaceFolder, 'notreally.big');

    await writeFile(
      archiveFsPath,
      buildArchive([
        { name: 'data/one.txt', content: '1' },
        { name: 'top.txt', content: 'T' },
      ]),
    );

    // Carries the extension but is not an archive
    await writeFile(strayFsPath, Buffer.from('nothing like a header', 'utf-8'));

    log = vscode.window.createOutputChannel('bigFS layout tests', {
      log: true,
    });
    model = new ArchiveModel(log);

    await model.whenReady();

    // A file written moments ago may not be indexed yet, and an archive is
    // only read once something asks for its content
    await waitFor(async () => {
      const archive = model.getArchiveByPath(archiveFsPath);

      assert.ok(archive, 'the archive was not listed');

      await archive.ensureLoaded();
    });
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await unlink(archiveFsPath).catch(() => undefined);
    await unlink(strayFsPath).catch(() => undefined);
  });

  /**
   * The archive, read: a watcher event for the file written in setup can
   * arrive late and drop what was read, which made these tests flaky
   */
  const loadedArchive = async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not listed');
    await archive.ensureLoaded();

    return archive;
  };

  test('extracts an archive without the extension in the folder name', async () => {
    const archive = await loadedArchive();

    const extracted = getExtractedFiles([archive.root], targetDirectory);

    assert.deepStrictEqual(extracted.map((file) => file.name).sort(), [
      'layout/data/one.txt',
      'layout/top.txt',
    ]);
  });

  test('extracts a folder under its own name', async () => {
    const archive = await loadedArchive();
    const folder = findChild(archive.root, 'data');

    assert.ok(folder, 'the folder is missing');

    const extracted = getExtractedFiles([folder], targetDirectory);

    assert.deepStrictEqual(
      extracted.map((file) => file.name),
      ['data/one.txt'],
    );
  });

  test('extracts a single file under its own name', async () => {
    const archive = await loadedArchive();
    const file = findChild(archive.root, 'top.txt');

    assert.ok(file, 'the file is missing');

    const extracted = getExtractedFiles([file], targetDirectory);

    assert.deepStrictEqual(
      extracted.map((file) => file.name),
      ['top.txt'],
    );
  });

  test('drops a file that carries the extension but is not an archive', async function () {
    // Waits on the file watcher, which is slower than mocha's default
    this.timeout(20_000);

    // Listed from its name, then dropped once reading it says otherwise
    await waitFor(() => {
      assert.strictEqual(model.getArchiveByPath(strayFsPath), undefined);

      return Promise.resolve();
    });

    assert.deepStrictEqual(
      model
        .getArchiveRoots()
        .map((root) => root.archive.rootPath)
        .filter((rootPath) => rootPath.endsWith('notreally.big')),
      [],
    );
  });
});

suite('Lazy loading', () => {
  const LAZY_ARCHIVE = 'lazy.big';

  test('lists an archive without reading it, and reads it when opened', async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const archiveFsPath = path.join(workspaceFolder, LAZY_ARCHIVE);

    await writeFile(
      archiveFsPath,
      buildArchive([{ name: 'data/deep/file.txt', content: 'X' }]),
    );

    const log = vscode.window.createOutputChannel('bigFS lazy tests', {
      log: true,
    });
    const model = new ArchiveModel(log, { readAhead: false });

    try {
      await model.whenReady();

      const archive = model.getArchiveByPath(archiveFsPath);

      assert.ok(archive, 'the archive was not listed');

      // Listed from its name alone: the index table is untouched
      assert.strictEqual(archive.isLoaded, false);
      assert.strictEqual(archive.root.children?.size, 0);

      const provider = new BigTreeDataProvider(model);
      const children = await childNames(provider, archive.root);

      assert.strictEqual(archive.isLoaded, true);
      assert.deepStrictEqual(children, ['data']);
    } finally {
      model.dispose();
      log.dispose();

      await unlink(archiveFsPath).catch(() => undefined);
    }
  });
  test('reads the archive a uri points into', async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const archiveFsPath = path.join(workspaceFolder, LAZY_ARCHIVE);

    await writeFile(
      archiveFsPath,
      buildArchive([{ name: 'data/deep/file.txt', content: 'X' }]),
    );

    try {
      // Nothing has expanded this archive, so opening a file has to read it
      await waitFor(async () => {
        assert.strictEqual(
          await readText(`/${LAZY_ARCHIVE}/data/deep/file.txt`),
          'X',
        );
      });
    } finally {
      await unlink(archiveFsPath).catch(() => undefined);
    }
  });
});
