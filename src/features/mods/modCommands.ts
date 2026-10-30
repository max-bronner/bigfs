import {
  FileType,
  ProgressLocation,
  Range,
  Uri,
  commands,
  window,
  workspace,
} from 'vscode';
import type { Disposable, QuickPickItem } from 'vscode';
import path from 'path';
import { writeArchiveFile } from '../../node/archiveFile';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getFileNodes } from '../../services/archives/virtualNode';
import type { VirtualNode } from '../../services/archives/virtualNode';
import { getNodeUri } from '../../services/archives/nodeAddress';
import { isSkippedFromPackage } from '../../node/modPackage';
import { recordPackedArchive } from '../../services/archives/packagedOutputs';
import { formatCount } from '../../core/messages';
import type { RegisterNodeCommand } from '../../services/archives/nodeCommands';
import { decodeWindows1252 } from '../../core/windows1252';
import { registerCommand } from '../../platform/commands';

/**
 * The commands a mod is made with: pack a folder into a `.big`, copy files
 * out of the game's archives into a mod folder to override them, and search
 * the text of every archive at once.
 */

/**
 * The bytes shipped BIG4 archives carry between the index table and the data,
 * which a new archive is given too
 */
const BIG4_TRAILER = Uint8Array.from([0x4c, 0x32, 0x31, 0x39, 0, 0, 0, 0]);

/** Entries a text search reads; binary formats would only match by accident */
const TEXT_ENTRY_PATTERN =
  /\.(ini|inc|bhav|str|txt|wnd|lua|xml|csv|cfg|scb|mll|htm|html)$/i;

/** Results a search stops at, which is more than anyone reads in a list */
const SEARCH_RESULT_LIMIT = 2000;

/** Lists every file below a folder on disk, with its size and its path relative to the folder, joined with '/' */
export const listFiles = async (
  folder: Uri,
  relative = '',
): Promise<{ uri: Uri; relativePath: string; size: number }[]> => {
  const files: { uri: Uri; relativePath: string; size: number }[] = [];

  for (const [name, type] of await workspace.fs.readDirectory(folder)) {
    const uri = Uri.joinPath(folder, name);
    const relativePath = relative ? `${relative}/${name}` : name;

    if (type === FileType.Directory) {
      files.push(...(await listFiles(uri, relativePath)));
    } else if (type === FileType.File) {
      files.push({
        uri,
        relativePath,
        size: (await workspace.fs.stat(uri)).size,
      });
    }
  }

  return files;
};

/**
 * Packs every file below a folder into a new BIG4 archive, named by its path
 * below the folder, and asks where to save it. Hidden files and folders such
 * as `.git` and `.vscode`, and archives, are not part of a mod.
 */
const packFolder = async (folder: Uri): Promise<void> => {
  if (folder.scheme !== 'file') {
    throw new Error('Only a folder on disk can be packed');
  }

  const target = await window.showSaveDialog({
    defaultUri: Uri.file(`${folder.fsPath}.big`),
    filters: { 'BIG archive': ['big'] },
    saveLabel: 'Pack',
  });

  if (!target) {
    return;
  }

  const count = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Packing ${path.basename(target.fsPath)}`,
    },
    () => packFolderInto(folder, target, isSkippedFromPackage),
  );

  if (count) {
    window.showInformationMessage(
      `Packed ${formatCount(count, 'file')} into ${path.basename(target.fsPath)}.`,
    );
  } else {
    window.showWarningMessage(
      `${path.basename(folder.fsPath)} holds no files.`,
    );
  }
};

/**
 * Writes every file below a folder, less those `skip` names, into a BIG4
 * archive at `target`, and returns how many it packed. Nothing is written
 * when there is nothing to pack.
 */
export const packFolderInto = async (
  folder: Uri,
  target: Uri,
  skip: (relativePath: string) => boolean = () => false,
): Promise<number> => {
  const files = (await listFiles(folder)).filter(
    (file) => !skip(file.relativePath),
  );

  if (files.length) {
    const entries = new Map<string, BigFileEntry>(
      files.map(({ uri, relativePath, size }) => [
        relativePath.toLowerCase(),
        { name: relativePath, offset: 0, size, pendingFile: uri.fsPath },
      ]),
    );

    await writeArchiveFile(
      target.fsPath,
      { magic: 'BIG4', trailer: BIG4_TRAILER },
      entries,
    );
    recordPackedArchive(target.fsPath);
  }

  return files.length;
};

/**
 * Copies files out of an archive into a folder on disk at the same path, so a
 * mod overrides them, and opens the first one
 */
const overrideInFolder = async (
  archiveModel: ArchiveModel,
  targets: VirtualNode[],
): Promise<void> => {
  const [folder] =
    (await window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: workspace.workspaceFolders?.[0]?.uri,
      openLabel: 'Copy Here',
      title: 'Folder of the mod that overrides these files',
    })) ?? [];

  if (!folder) {
    return;
  }

  const fileNodes = targets.flatMap((target) => getFileNodes(target));
  const destinations = fileNodes.map((node) => ({
    node,
    uri: Uri.joinPath(folder, ...node.entryPath.split('/')),
  }));
  const existing: string[] = [];

  for (const { node, uri } of destinations) {
    try {
      await workspace.fs.stat(uri);
      existing.push(node.entryPath);
    } catch {
      // not there yet, which is the usual case
    }
  }

  if (existing.length) {
    const answer = await window.showWarningMessage(
      `${formatCount(existing.length, 'file')} already in the folder will be replaced.`,
      { modal: true, detail: existing.slice(0, 10).join('\n') },
      'Replace',
    );

    if (answer !== 'Replace') {
      return;
    }
  }

  await archiveModel.readFiles(destinations, async ({ uri }, content) => {
    await workspace.fs.writeFile(uri, content);
  });

  window.showInformationMessage(
    `Copied ${formatCount(destinations.length, 'file')} into ${path.basename(folder.fsPath)}.`,
  );

  if (destinations.length === 1) {
    await commands.executeCommand('vscode.open', destinations[0].uri);
  }
};

/** One line that matched a search, as the result list shows it */
export interface SearchResult extends QuickPickItem {
  uri: Uri;
  line: number;
  start: number;
  length: number;
}

/**
 * Finds a phrase in the text entries of every archive, without regard to
 * casing, up to `SEARCH_RESULT_LIMIT` lines
 */
export const findInArchives = async (
  archiveModel: ArchiveModel,
  phrase: string,
  {
    onArchive = () => undefined,
    isCancelled = () => false,
  }: {
    onArchive?: (name: string, share: number) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<SearchResult[]> => {
  const needle = phrase.toLowerCase();
  const results: SearchResult[] = [];

  const roots = archiveModel.getArchiveRoots();

  for (const root of roots) {
    if (isCancelled() || results.length >= SEARCH_RESULT_LIMIT) {
      break;
    }

    onArchive(root.name, 100 / roots.length);

    try {
      await archiveModel.loadArchiveOf(root);
    } catch {
      continue; // an archive that does not read holds nothing to find
    }

    const nodes = getFileNodes(root).filter((node) =>
      TEXT_ENTRY_PATTERN.test(node.name),
    );

    await archiveModel.readFiles(
      nodes.map((node) => ({ node })),
      async ({ node }, content) => {
        const text = decodeWindows1252(content);

        if (!text.toLowerCase().includes(needle)) {
          return;
        }

        text.split(/\r?\n/).forEach((line, index) => {
          const start = line.toLowerCase().indexOf(needle);

          if (start >= 0 && results.length < SEARCH_RESULT_LIMIT) {
            results.push({
              label: line.trim(),
              description: `${root.name}/${node.entryPath}:${index + 1}`,
              uri: getNodeUri(node),
              line: index,
              start,
              length: phrase.length,
            });
          }
        });
      },
    );
  }

  return results;
};

/**
 * Searches the text entries of every archive for a phrase, without regard
 * to casing, and opens the result picked. VS Code's own search does not look
 * inside archives, which is what this is for.
 */
const searchArchives = async (archiveModel: ArchiveModel): Promise<void> => {
  const phrase = await window.showInputBox({
    prompt: 'Text to find in every archive',
    placeHolder: 'GondorFighter',
  });

  if (!phrase) {
    return;
  }

  const results = await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Searching archives for "${phrase}"`,
      cancellable: true,
    },
    (progress, token) =>
      findInArchives(archiveModel, phrase, {
        onArchive: (name, share) =>
          progress.report({ message: name, increment: share }),
        isCancelled: () => token.isCancellationRequested,
      }),
  );

  if (!results.length) {
    window.showInformationMessage(`No archive holds "${phrase}".`);
    return;
  }

  const picked = await window.showQuickPick(results, {
    title: `${formatCount(results.length, 'result')} for "${phrase}"${results.length >= SEARCH_RESULT_LIMIT ? ' (first ' + SEARCH_RESULT_LIMIT + ')' : ''}`,
    matchOnDescription: true,
  });

  if (picked) {
    await window.showTextDocument(picked.uri, {
      selection: new Range(
        picked.line,
        picked.start,
        picked.line,
        picked.start + picked.length,
      ),
    });
  }
};

/**
 * Registers the mod commands: the folder and palette ones directly, and the
 * one on archive entries through the node command register
 */
export const registerModCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): Disposable[] => {
  register('bigfs.overrideInFolder', (targets) =>
    overrideInFolder(archiveModel, targets),
  );

  return [
    registerCommand('bigfs.packFolder', (folder?: Uri) =>
      folder ? packFolder(folder) : undefined,
    ),
    registerCommand('bigfs.searchArchives', () =>
      searchArchives(archiveModel),
    ),
  ];
};
