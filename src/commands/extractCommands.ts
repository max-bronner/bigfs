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
import { getParentPath, splitPath } from '../common/paths';
import { getNodeUri } from '../common/uri';
import { resolveConflicts } from '../ui/dialogs';
import { getFileNodes, getTopLevelNodes } from '../model/virtualNode';
import type { RegisterNodeCommand } from './commandCenter';
import type { VirtualNode } from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';

const REVEAL_LABEL = 'Reveal in File Explorer';

interface ExtractedFile {
  name: string;
  node: VirtualNode;
  targetUri: Uri;
}

const getExtractedFiles = (
  nodes: readonly VirtualNode[],
  targetDirectoryUri: Uri,
): ExtractedFile[] => {
  const extractedFiles: ExtractedFile[] = [];

  for (const node of nodes) {
    const basePath = getParentPath(node.path);

    for (const fileNode of getFileNodes(node)) {
      const relativePath = fileNode.path.slice(basePath.length + 1);

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

const extractToFile = async (node: VirtualNode): Promise<Uri | undefined> => {
  const targetUri = await window.showSaveDialog({
    defaultUri: Uri.file(node.name),
    saveLabel: 'Extract',
  });

  if (!targetUri) {
    return undefined;
  }

  const content = await workspace.fs.readFile(getNodeUri(node.path));

  await workspace.fs.writeFile(targetUri, content);

  return targetUri;
};

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

export const registerExtractCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  register('extract', (targets) => extractNodes(archiveModel, targets));
};
