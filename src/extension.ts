import { type ExtensionContext, workspace, commands, type Uri } from 'vscode';
import { BigFileSystemProvider } from './big/fsProvider';
import { SCHEME } from './constants';

export async function activate(context: ExtensionContext) {
  const provider = new BigFileSystemProvider();
  const files = await workspace.findFiles('**/*.big');

  context.subscriptions.push(
    workspace.registerFileSystemProvider(SCHEME, provider, {
      isReadonly: true,
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
