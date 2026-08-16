import * as vscode from 'vscode';
import { VirtualFileService } from './big/virtualFileService';
import { BigFileSystemProvider } from './big/fsProvider';
import { BigExplorerProvider } from './big/bigExplorer';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const fileService = new VirtualFileService();

  const setScanning = (scanning: boolean) =>
    vscode.commands.executeCommand(
      'setContext',
      `${SCHEME}.scanning`,
      scanning,
    );

  setScanning(true);
  fileService.whenReady().finally(() => setScanning(false));

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
  context.subscriptions.push(
    vscode.window.createTreeView('bigArchiveExplorer', {
      treeDataProvider: explorerProvider,
      dragAndDropController: explorerProvider,
      showCollapseAll: true,
    }),
  );

  // Manual refresh
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SCHEME}.refreshArchives`, async () => {
      setScanning(true);

      try {
        await fileService.scanWorkspace();
      } finally {
        setScanning(false);
      }

      explorerProvider.refresh();
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
