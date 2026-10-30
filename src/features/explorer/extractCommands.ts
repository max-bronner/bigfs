import {
  commands,
  window,
  workspace,
  CancellationError,
  FileType,
  ProgressLocation,
  Uri,
} from 'vscode';
import type { CancellationToken, Progress } from 'vscode';
import path from 'path';
import { isContainedPath, splitPath } from '../../core/paths';
import { resolveConflicts } from '../../platform/dialogs';
import {
  getFileNodes,
  getRelativeEntryPath,
  getTopLevelNodes,
  isArchiveRoot,
} from '../../services/archives/virtualNode';
import { getNodeUri } from '../../services/archives/nodeAddress';
import type { RegisterNodeCommand } from './commandCenter';
import type { VirtualNode } from '../../services/archives/virtualNode';
import type { ArchiveModel } from '../../services/archives/archiveModel';

const REVEAL_LABEL = 'Reveal in File Explorer';

/**
 * One file an extraction will write: the node to read it from, the uri it goes
 * to, and the path below the picked directory that names it in a prompt
 */
interface ExtractedFile {
  name: string;
  node: VirtualNode;
  targetUri: Uri;
}

/**
 * Gets the name a node's contents are written under. An archive drops the
 * extension it is named by, so extracting `textures.big` writes into
 * `textures/`.
 */
const getExtractedName = (node: VirtualNode): string =>
  isArchiveRoot(node)
    ? node.name.slice(
        0,
        node.name.length - path.posix.extname(node.name).length,
      )
    : node.name;

/** Gets the path an extracted file is written to, relative to the directory the user picked */
const getExtractedPath = (node: VirtualNode, fileNode: VirtualNode): string =>
  fileNode === node
    ? node.name
    : `${getExtractedName(node)}/${getRelativeEntryPath(node, fileNode)}`;

/**
 * Plans what an extraction writes: every file at or below each node, paired
 * with the uri it goes to under the picked directory. Reads and writes
 * nothing, so it can be checked on its own.
 */
export const getExtractedFiles = (
  nodes: readonly VirtualNode[],
  targetDirectoryUri: Uri,
): ExtractedFile[] => {
  const extractedFiles: ExtractedFile[] = [];

  for (const node of nodes) {
    for (const fileNode of getFileNodes(node)) {
      const relativePath = getExtractedPath(node, fileNode);

      // Checked again here, after the archive name is prefixed, because the
      // target uri is built with `Uri.joinPath`, which resolves `..`
      if (!isContainedPath(relativePath)) {
        throw new Error(
          `Refusing to extract outside the target: ${relativePath}`,
        );
      }

      extractedFiles.push({
        name: relativePath,
        node: fileNode,
        targetUri: Uri.joinPath(targetDirectoryUri, ...splitPath(relativePath)),
      });
    }
  }

  return extractedFiles;
};

const exists = async (uri: Uri): Promise<boolean> => {
  try {
    await workspace.fs.stat(uri);

    return true;
  } catch {
    return false;
  }
};

/**
 * Drops the files the user will not overwrite, asking once for every target
 * that already exists on disk
 */
const withoutRefusedFiles = async (
  extractedFiles: ExtractedFile[],
): Promise<ExtractedFile[]> => {
  const takenNames = new Set<string>();

  for (const file of extractedFiles) {
    if (await exists(file.targetUri)) {
      takenNames.add(file.name);
    }
  }

  return resolveConflicts(extractedFiles, (file) => takenNames.has(file.name));
};

/**
 * Writes one file wherever the user saves it, keeping nothing of the path it
 * had in the archive. Undefined when the dialog is dismissed.
 */
const extractToFile = async (node: VirtualNode): Promise<Uri | undefined> => {
  const targetUri = await window.showSaveDialog({
    defaultUri: Uri.file(node.name),
    saveLabel: 'Extract',
  });

  if (!targetUri) {
    return undefined;
  }

  const content = await workspace.fs.readFile(getNodeUri(node));

  await workspace.fs.writeFile(targetUri, content);

  return targetUri;
};

/**
 * Writes nodes below a directory the user picks, under a cancellable progress
 * notification. Undefined when the user cancels, dismisses a dialog, or
 * refuses every overwrite.
 */
const extractToDirectory = async (
  archiveModel: ArchiveModel,
  nodes: readonly VirtualNode[],
): Promise<Uri | undefined> => {
  const targetDirectoryUris = await window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Extract Here',
  });

  const targetDirectoryUri = targetDirectoryUris?.[0];

  if (!targetDirectoryUri) {
    return undefined;
  }

  const extractedFiles = await withoutRefusedFiles(
    getExtractedFiles(nodes, targetDirectoryUri),
  );

  if (!extractedFiles.length) {
    return undefined;
  }

  const writeFiles = async (
    progress: Progress<{ message?: string; increment?: number }>,
    token: CancellationToken,
  ): Promise<void> => {
    const increment = 100 / extractedFiles.length;
    let written = 0;

    await archiveModel.readFiles(extractedFiles, async (file, content) => {
      if (token.isCancellationRequested) {
        // Thrown rather than returned, as it is the only way out of a batch
        // read already in progress
        throw new CancellationError();
      }

      written += 1;
      progress.report({
        increment,
        message: `${written} of ${extractedFiles.length}`,
      });

      await workspace.fs.writeFile(file.targetUri, content);
    });
  };

  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Extracting',
        cancellable: true,
      },
      writeFiles,
    );
  } catch (error) {
    if (error instanceof CancellationError) {
      return undefined;
    }

    throw error;
  }

  return targetDirectoryUri;
};

/**
 * Extracts a selection to disk, then offers to reveal what was written. A lone
 * file is saved wherever the user names it; anything else is written below a
 * directory they pick.
 */
const extractNodes = async (
  archiveModel: ArchiveModel,
  nodes: readonly VirtualNode[],
): Promise<void> => {
  const topLevelNodes = getTopLevelNodes(nodes);
  const singleFile =
    topLevelNodes.length === 1 && topLevelNodes[0].type === FileType.File
      ? topLevelNodes[0]
      : undefined;

  const targetUri = singleFile
    ? await extractToFile(singleFile)
    : await extractToDirectory(archiveModel, topLevelNodes);

  if (!targetUri) {
    return;
  }

  const selectedOption = await window.showInformationMessage(
    `Extracted to ${targetUri.fsPath}.`,
    REVEAL_LABEL,
  );

  if (selectedOption === REVEAL_LABEL) {
    await commands.executeCommand('revealFileInOS', targetUri);
  }
};

/**
 * Registers the palette and context menu entry for extracting nodes to disk,
 * through the register callback the command center hands out
 */
export const registerExtractCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  register('bigfs.extract', (targets) => extractNodes(archiveModel, targets));
};
