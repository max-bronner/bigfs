import * as vscode from 'vscode';
import { ArchiveModel } from './model/archiveModel';
import { BigFileSystemProvider } from './providers/fileSystemProvider';
import { BigTreeDataProvider } from './providers/treeDataProvider';
import { BigDragAndDropController } from './providers/dragAndDropController';
import { createNodeCommandRegister } from './commands/commandCenter';
import { registerFileCommands } from './commands/fileCommands';
import { registerExtractCommands } from './commands/extractCommands';
import { registerClipboardCommands } from './commands/clipboardCommands';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('bigFS', { log: true });
  const archiveModel = new ArchiveModel(log);

  context.subscriptions.push(log, archiveModel);

  const setContextKey = (key: string, value: boolean) =>
    vscode.commands.executeCommand('setContext', `${SCHEME}.${key}`, value);

  const markScanned = async () => {
    await setContextKey(
      'hasArchives',
      archiveModel.getArchiveRoots().length > 0,
    );
    await setContextKey('scanned', true);
  };

  archiveModel.whenReady().finally(markScanned);

  const fileSystemProvider = new BigFileSystemProvider(archiveModel);
  const treeDataProvider = new BigTreeDataProvider(archiveModel);
  const dragAndDropController = new BigDragAndDropController(archiveModel);

  // Registration of file system provider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: false,
    }),
  );

  // Registration of tree data provider
  const treeView = vscode.window.createTreeView('bigArchiveExplorer', {
    treeDataProvider,
    dragAndDropController,
    showCollapseAll: true,
    canSelectMany: true,
  });

  context.subscriptions.push(treeView);

  const registerNodeCommand = createNodeCommandRegister(context, treeView);

  registerFileCommands(registerNodeCommand, archiveModel);
  registerExtractCommands(registerNodeCommand, archiveModel);
  registerClipboardCommands(registerNodeCommand, archiveModel);

  // Manual refresh
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SCHEME}.refreshArchives`, async () => {
      await setContextKey('scanned', false);

      try {
        await archiveModel.scanWorkspace();
      } finally {
        treeDataProvider.refresh();
        await markScanned();
      }
    }),
  );

  // Show message when file is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme === SCHEME) {
        vscode.window.showInformationMessage(
          `BIG archive updated: ${document.uri.path}`,
          { modal: false },
        );
      }
    }),
  );
}

export function deactivate() {}
