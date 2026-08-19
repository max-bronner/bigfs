import * as vscode from 'vscode';
import { VirtualFileService } from './big/virtualFileService';
import { BigFileSystemProvider } from './big/fsProvider';
import { BigExplorerProvider } from './big/bigExplorer';
import { createNodeCommandRegister } from './commands/commandCenter';
import { registerFileCommands } from './commands/fileCommands';
import { registerExtractCommands } from './commands/extractCommands';
import { registerClipboardCommands } from './commands/clipboardCommands';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const fileService = new VirtualFileService();

  context.subscriptions.push(fileService);

  const setContextKey = (key: string, value: boolean) =>
    vscode.commands.executeCommand('setContext', `${SCHEME}.${key}`, value);

  const markScanned = async () => {
    await setContextKey('hasArchives', fileService.getArchives().size > 0);
    await setContextKey('scanned', true);
  };

  fileService.whenReady().finally(markScanned);

  const fsProvider = new BigFileSystemProvider(fileService);
  const explorerProvider = new BigExplorerProvider(fileService);

  // Registration of file system provider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, {
      isCaseSensitive: false,
      isReadonly: false,
    }),
  );

  // Registration of tree data provider
  const treeView = vscode.window.createTreeView('bigArchiveExplorer', {
    treeDataProvider: explorerProvider,
    dragAndDropController: explorerProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });

  context.subscriptions.push(treeView);

  const registerNodeCommand = createNodeCommandRegister(context, treeView);

  registerFileCommands(registerNodeCommand, fileService);
  registerExtractCommands(registerNodeCommand);
  registerClipboardCommands(registerNodeCommand, fileService);

  // Manual refresh
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SCHEME}.refreshArchives`, async () => {
      await setContextKey('scanned', false);

      try {
        await fileService.scanWorkspace();
      } finally {
        explorerProvider.refresh();
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
