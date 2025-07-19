import * as vscode from 'vscode';
import { FileService } from './big/virtualFileSystem';
import { BigFileSystemProvider } from './big/fsProvider';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const fileService = new FileService();
  const fsProvider = new BigFileSystemProvider(fileService);

  // Registration of file system provider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fsProvider, {
      isCaseSensitive: false,
      isReadonly: true, // Todo: implement write support
    })
  );

  context.subscriptions.push(
    commands.registerCommand('bigExplorer.showData', (resourceUri: Uri) => {
      const info = provider.readDirectory(resourceUri);
      console.log(info);
    })
  );

  console.log('BIG Explorer extension activated');
}

export function deactivate() {
  console.log('BIG Explorer extension deactivated');
}
