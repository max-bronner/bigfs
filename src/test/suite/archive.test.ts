import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../binary/bigFormat';
import type { BigFileEntry } from '../../binary/bigFormat';
import { ArchiveModel } from '../../model/archiveModel';
import {
  BigTreeDataProvider,
  BigTreeItem,
} from '../../providers/treeDataProvider';
import { findChild, getFileNodes } from '../../model/virtualNode';
import { getExtractedFiles } from '../../commands/extractCommands';
import { createToolRegistry } from '../../tools/toolRegistry';
import { createFormatRegistry } from '../../formats/formatRegistry';
import type { VirtualNode } from '../../model/virtualNode';
import { isVirtualNode } from '../../providers/explorerNode';
import type { ExplorerNode } from '../../providers/explorerNode';

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

  test('keeps a name stored in two casings through an unrelated save', async () => {
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
});

suite('Tree refresh', () => {
  const REFRESH_ARCHIVE = 'refresh.big';

  let archiveFsPath: string;
  let nestedDirectory: string;
  let nestedFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  /** The row the explorer would draw for a node, collapsed */
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

  test('lists directories before files, each by name', async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const provider = new BigTreeDataProvider(model);

    // data sorts after a.txt by name, and still comes first
    assert.deepStrictEqual(await childNames(provider, archive.root), [
      'data',
      'a.txt',
    ]);

    const data = findChild(archive.root, 'data');

    assert.ok(data, 'the folder is missing');
    assert.deepStrictEqual(await childNames(provider, data), [
      'one.txt',
      'two.txt',
    ]);
  });

  test('refreshes the archive that changed instead of the whole view', async () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const provider = new BigTreeDataProvider(model);
    const refreshed: (ExplorerNode | undefined | void)[] = [];
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

    // Archives of the other suites come and go in the same workspace, and
    // those do ask for the whole view. What matters is that the write asked
    // for this archive, which a provider that always refreshes never does.
    assert.ok(
      refreshed.includes(rootBefore),
      'the archive that changed was not refreshed on its own',
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

  test('extracts an archive without the extension in the folder name', () => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const extracted = getExtractedFiles([archive.root], targetDirectory);

    assert.deepStrictEqual(
      extracted.map((file) => file.name).sort(),
      ['layout/data/one.txt', 'layout/top.txt'],
    );
  });

  test('extracts a folder under its own name', () => {
    const archive = model.getArchiveByPath(archiveFsPath);
    const folder = findChild(archive!.root, 'data');

    assert.ok(folder, 'the folder is missing');

    const extracted = getExtractedFiles([folder], targetDirectory);

    assert.deepStrictEqual(
      extracted.map((file) => file.name),
      ['data/one.txt'],
    );
  });

  test('extracts a single file under its own name', () => {
    const archive = model.getArchiveByPath(archiveFsPath);
    const file = findChild(archive!.root, 'top.txt');

    assert.ok(file, 'the file is missing');

    const extracted = getExtractedFiles([file], targetDirectory);

    assert.deepStrictEqual(
      extracted.map((file) => file.name),
      ['top.txt'],
    );
  });

  test('drops a file that carries the extension but is not an archive', async () => {
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

suite('Format registry', () => {
  const FORMAT_ARCHIVE = 'formats.big';

  let archiveFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;

    archiveFsPath = path.join(workspaceFolder, FORMAT_ARCHIVE);

    await writeFile(
      archiveFsPath,
      buildArchive([
        { name: 'movies/unit.apt', content: 'APT' },
        { name: 'movies/unit.const', content: 'CONST' },
        { name: 'movies/unit.dat', content: 'DAT' },
        { name: 'movies/other.apt', content: 'OTHER' },
      ]),
    );

    log = vscode.window.createOutputChannel('bigFS format tests', {
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
  });

  /** The context an entry of the suite's archive would be parsed through */
  const contextFor = (entryPath: string) => {
    const archive = model.getArchiveByPath(archiveFsPath);

    assert.ok(archive, 'the archive was not loaded');

    const node = findChild(archive.root, entryPath);

    assert.ok(node, `${entryPath} is missing`);

    const registry = createFormatRegistry(model, createToolRegistry());
    const context = registry.createContext(node);

    assert.ok(context, 'no context for the entry');

    return context;
  };

  test('finds the siblings an entry needs', () => {
    const context = contextFor('movies/unit.apt');

    assert.strictEqual(context.sibling('.const')?.name, 'unit.const');
    assert.strictEqual(context.sibling('.dat')?.name, 'unit.dat');

    // A sibling that does not exist is absent, not an error
    assert.strictEqual(context.sibling('.missing'), undefined);
  });

  test('does not mistake another entry for a sibling', () => {
    const context = contextFor('movies/unit.apt');

    // other.apt sits beside it, so matching on the extension alone would win
    assert.strictEqual(context.sibling('.apt')?.name, 'unit.apt');
  });

  test('reads the bytes of a group of entries', async () => {
    const context = contextFor('movies/unit.apt');

    const group = [
      context.entry,
      context.sibling('.const')!,
      context.sibling('.dat')!,
    ];

    const contents = await context.readAll(group);
    const asText = new Map(
      Array.from(contents, ([entryPath, bytes]) => [
        entryPath,
        Buffer.from(bytes).toString('utf-8'),
      ]),
    );

    assert.deepStrictEqual(
      asText,
      new Map([
        ['movies/unit.apt', 'APT'],
        ['movies/unit.const', 'CONST'],
        ['movies/unit.dat', 'DAT'],
      ]),
    );
  });

  test('claims an entry only when a format matches it', () => {
    const archive = model.getArchiveByPath(archiveFsPath)!;
    const registry = createFormatRegistry(model, createToolRegistry());
    const apt = findChild(archive.root, 'movies/unit.apt')!;

    assert.strictEqual(registry.find(apt), undefined);

    registry.register({
      id: 'test.apt',
      matches: (entry) => entry.name.toLowerCase().endsWith('.apt'),
      parse: async () => undefined,
    });

    assert.strictEqual(registry.find(apt)?.id, 'test.apt');
    assert.strictEqual(
      registry.find(findChild(archive.root, 'movies/unit.dat')!),
      undefined,
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

  test('reads the archives nobody opened, in the background', async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const archiveFsPath = path.join(workspaceFolder, 'background.big');

    await writeFile(
      archiveFsPath,
      buildArchive([{ name: 'data/file.txt', content: 'X' }]),
    );

    const log = vscode.window.createOutputChannel('bigFS background tests', {
      log: true,
    });
    const model = new ArchiveModel(log);

    try {
      await model.whenReady();

      // Nothing asks for it, so reading ahead is what has to get there
      await waitFor(() => {
        const archive = model.getArchiveByPath(archiveFsPath);

        assert.ok(archive, 'the archive was not listed');
        assert.strictEqual(archive.isLoaded, true);

        return Promise.resolve();
      });

      assert.ok(
        findChild(model.getArchiveByPath(archiveFsPath)!.root, 'data/file.txt'),
        'the entries were not read',
      );
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

suite('Archive sources', () => {
  const SOURCE_ARCHIVE = 'sourced.big';

  let archiveFsPath: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;

  suiteSetup(async function () {
    this.timeout(30_000);

    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;

    archiveFsPath = path.join(workspaceFolder, SOURCE_ARCHIVE);

    await writeFile(
      archiveFsPath,
      buildArchive([{ name: 'readme.txt', content: 'Sourced' }]),
    );

    log = vscode.window.createOutputChannel('bigFS source tests', {
      log: true,
    });
    model = new ArchiveModel(log);

    await model.whenReady();
  });

  suiteTeardown(async () => {
    model.dispose();
    log.dispose();

    await unlink(archiveFsPath).catch(() => undefined);
  });

  test('names the source before the path inside it', () => {
    const archive = model.getArchiveByPath(archiveFsPath);
    const source = vscode.workspace.workspaceFolders![0].name.toLowerCase();

    assert.ok(archive, 'the archive was not listed');
    assert.strictEqual(archive.rootPath, `/${source}/${SOURCE_ARCHIVE}`);
  });

  test('does not resolve a path that leaves out its source', async () => {
    // A path with no source, which two archives of the same name could both claim
    const withoutSource = vscode.Uri.from({
      scheme: 'bigfs',
      path: `/${SOURCE_ARCHIVE}/readme.txt`,
    });

    await assert.rejects(async () => {
      await vscode.workspace.fs.stat(withoutSource);
    });

    // The same entry resolves once the source is named
    await waitFor(async () => {
      assert.strictEqual(
        await readText(`/${SOURCE_ARCHIVE}/readme.txt`),
        'Sourced',
      );
    });
  });
});
