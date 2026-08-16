import {
  commands,
  window,
  workspace,
  FileType,
  ProgressLocation,
  Uri,
} from 'vscode';
import type { ExtensionContext, Progress, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import {
  deleteNodes,
  getNodeUri,
  getParentPath,
  getTopLevelNodes,
  importFromDisk,
  resolveConflicts,
} from './fileOperations';
import type { VirtualNode } from '../types';
import type { VirtualFileService } from './virtualFileService';

const SEPARATOR_PATTERN = /[\\/]/;

const REVEAL_LABEL = 'Reveal in File Explorer';

interface ExtractedFile {
  name: string;
  nodePath: string;
  targetUri: Uri;
}

interface NamePrompt {
  title: string;
  takenNames: Set<string>;
  currentName?: string;
}

const getTargetDirectoryPath = (node: VirtualNode): string =>
  node.type === FileType.Directory ? node.path : getParentPath(node.path);

const readChildNames = async (directoryPath: string): Promise<Set<string>> => {
  const children = await workspace.fs.readDirectory(getNodeUri(directoryPath));

  return new Set(children.map(([name]) => name));
};

const askForName = async (prompt: NamePrompt): Promise<string | undefined> => {
  const validateName = (input: string): string | undefined => {
    const name = input.trim();

    if (!name) {
      return 'A name is required.';
    }

    if (SEPARATOR_PATTERN.test(name)) {
      return 'A name cannot contain a path separator.';
    }

    if (name !== prompt.currentName && prompt.takenNames.has(name)) {
      return `${name} already exists here.`;
    }

    return undefined;
  };

  const name = await window.showInputBox({
    title: prompt.title,
    value: prompt.currentName,
    validateInput: validateName,
  });

  return name?.trim();
};

const createFile = async (target: VirtualNode): Promise<void> => {
  const directoryPath = getTargetDirectoryPath(target);
  const takenNames = await readChildNames(directoryPath);

  const name = await askForName({ title: 'New File', takenNames });

  if (!name) {
    return;
  }

  const uri = getNodeUri(`${directoryPath}/${name}`);

  await workspace.fs.writeFile(uri, new Uint8Array());
  await commands.executeCommand('vscode.open', uri);
};

const createFolder = async (target: VirtualNode): Promise<void> => {
  const directoryPath = getTargetDirectoryPath(target);
  const takenNames = await readChildNames(directoryPath);

  const name = await askForName({ title: 'New Folder', takenNames });

  if (!name) {
    return;
  }

  await workspace.fs.createDirectory(getNodeUri(`${directoryPath}/${name}`));
};

const renameNode = async (target: VirtualNode): Promise<void> => {
  const parentPath = getParentPath(target.path);
  const takenNames = await readChildNames(parentPath);

  const name = await askForName({
    title: 'Rename',
    takenNames,
    currentName: target.name,
  });

  if (!name || name === target.name) {
    return;
  }

  await workspace.fs.rename(
    getNodeUri(target.path),
    getNodeUri(`${parentPath}/${name}`),
    { overwrite: false },
  );
};

const getFileNodes = (node: VirtualNode): VirtualNode[] => {
  if (node.type === FileType.File) {
    return [node];
  }

  const fileNodes: VirtualNode[] = [];

  for (const child of node.children?.values() ?? []) {
    fileNodes.push(...getFileNodes(child));
  }

  return fileNodes;
};

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
        nodePath: fileNode.path,
        targetUri: Uri.joinPath(targetDirectoryUri, ...relativePath.split('/')),
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
  ): Promise<void> => {
    const increment = 100 / extractedFiles.length;
    let written = 0;

    for (const { nodePath, targetUri } of extractedFiles) {
      written += 1;
      progress.report({
        increment,
        message: `${written} of ${extractedFiles.length}`,
      });

      const content = await workspace.fs.readFile(getNodeUri(nodePath));

      await workspace.fs.writeFile(targetUri, content);
    }
  };

  await window.withProgress(
    { location: ProgressLocation.Notification, title: 'Extracting' },
    writeFiles,
  );

  return targetDirectoryUri;
};

const extractNodes = async (nodes: readonly VirtualNode[]): Promise<void> => {
  const topLevelNodes = getTopLevelNodes(nodes);
  const singleFile =
    topLevelNodes.length === 1 && topLevelNodes[0].type === FileType.File
      ? topLevelNodes[0]
      : undefined;

  const targetUri = singleFile
    ? await extractToFile(singleFile)
    : await extractToDirectory(topLevelNodes);

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

export const registerArchiveCommands = (
  context: ExtensionContext,
  fileService: VirtualFileService,
  treeView: TreeView<VirtualNode>,
): void => {
  const getTargets = (
    target?: VirtualNode,
    selection?: VirtualNode[],
  ): VirtualNode[] => {
    if (selection?.length) {
      return selection;
    }

    return target ? [target] : [...treeView.selection];
  };

  const register = (
    name: string,
    run: (targets: VirtualNode[]) => Promise<void>,
  ): void => {
    const execute = async (
      target?: VirtualNode,
      selection?: VirtualNode[],
    ): Promise<void> => {
      const targets = getTargets(target, selection);

      if (!targets.length) {
        return;
      }

      try {
        await run(targets);
      } catch (error) {
        window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    context.subscriptions.push(
      commands.registerCommand(`${SCHEME}.${name}`, execute),
    );
  };

  const addFiles = async (target: VirtualNode): Promise<void> => {
    const directoryPath = getTargetDirectoryPath(target);
    const directory = fileService.getNode(getNodeUri(directoryPath));

    if (!directory) {
      return;
    }

    const sourceUris = await window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Add to Archive',
    });

    if (!sourceUris?.length) {
      return;
    }

    const importedData = await importFromDisk(
      fileService,
      sourceUris,
      directory,
    );

    if (importedData) {
      const files = `${importedData} file${importedData === 1 ? '' : 's'}`;

      window.showInformationMessage(`Added ${files} to ${directory.name}.`);
    }
  };

  register('newFile', ([target]) => createFile(target));
  register('newFolder', ([target]) => createFolder(target));
  register('rename', ([target]) => renameNode(target));
  register('addFiles', ([target]) => addFiles(target));
  register('extract', (targets) => extractNodes(targets));
  register('delete', async (targets) => {
    await deleteNodes(fileService, targets);
  });
};
