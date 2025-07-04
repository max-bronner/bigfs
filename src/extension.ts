import type { ExtensionContext } from 'vscode';

export async function activate(context: ExtensionContext) {
  const scheme = 'bigfs';

  console.log('BIG Explorer extension activated');
}

export function deactivate() {
  console.log('BIG Explorer extension deactivated');
}
