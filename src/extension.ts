import * as vscode from 'vscode';
import { FileService } from './big/virtualFileSystem';
import { BigFileSystemProvider } from './big/fsProvider';
import { BigExplorerProvider } from './big/bigExplorer';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const fileService = new FileService();
  const fsProvider = new BigFileSystemProvider(fileService);
  const explorerProvider = new BigExplorerProvider(fileService);

  // Registration of file system provider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, {
      isCaseSensitive: false,
      isReadonly: true, // Todo: implement write support
    })
  );

  // Registration of tree data provider
  context.subscriptions.push(
    vscode.window.createTreeView('bigArchiveExplorer', {
      treeDataProvider: explorerProvider,
      showCollapseAll: true,
    })
  );

  console.log('BIG Explorer extension activated');
}

export function deactivate() {
  console.log('BIG Explorer extension deactivated');
}
