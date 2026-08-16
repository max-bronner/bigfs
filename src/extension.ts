import * as vscode from 'vscode';
import { VirtualFileService } from './big/virtualFileService';
import { BigFileSystemProvider } from './big/fsProvider';
import { BigExplorerProvider } from './big/bigExplorer';
import { registerArchiveCommands } from './big/archiveCommands';
import { registerClipboardCommands } from './big/clipboardCommands';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const fileService = new VirtualFileService();

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

  registerArchiveCommands(context, fileService, treeView);
  registerClipboardCommands(context, fileService, treeView);

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
