import { ConfigurationTarget, commands, window, workspace } from 'vscode';
import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { SCHEME } from '../../constants';
import { BigFileSystemProvider } from './fileSystemProvider';
import {
  BigTreeDataProvider,
  VIEW_SETTING,
  isGameViewShown,
} from './treeDataProvider';
import { BigDragAndDropController } from './dragAndDropController';
import { createNodeCommandRegister } from './commandCenter';
import { registerFileCommands } from './fileCommands';
import { registerExtractCommands } from './extractCommands';
import { registerClipboardCommands } from './clipboardCommands';
import { registerModCommands } from '../mods/modCommands';

/**
 * Registers the archive explorer: the `bigfs` file system, the tree view with
 * its archive and game views, and the commands on its rows.
 *
 * The mod commands are registered here rather than in `features/mods`
 * because one of them is a row command, which needs this tree view.
 */
export const registerExplorer = (
  context: ExtensionContext,
  { archives, gameView }: Services,
): void => {
  // scanned and hasArchives gate the welcome views declared in package.json
  const setContextKey = (key: string, value: boolean) =>
    commands.executeCommand('setContext', `bigfs.${key}`, value);

  const markScanned = async () => {
    await setContextKey('hasArchives', archives.getArchiveRoots().length > 0);
    await setContextKey('scanned', true);
  };

  // not awaited: activation returns before the scan does, and the tree is
  // usable while it runs
  archives.whenReady().finally(markScanned);

  const fileSystemProvider = new BigFileSystemProvider(archives);
  const treeDataProvider = new BigTreeDataProvider(archives, gameView);

  // The context key picks which of the two view buttons the title bar shows
  const showView = (isGame: boolean) =>
    workspace
      .getConfiguration()
      .update(
        VIEW_SETTING,
        isGame ? 'game' : 'archives',
        ConfigurationTarget.Workspace,
      );

  void setContextKey('gameView', isGameViewShown());
  context.subscriptions.push(
    commands.registerCommand('bigfs.showGameView', () => showView(true)),
    commands.registerCommand('bigfs.showArchiveView', () => showView(false)),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(VIEW_SETTING)) {
        void setContextKey('gameView', isGameViewShown());
        treeDataProvider.refresh();
      }
    }),
    workspace.registerFileSystemProvider(SCHEME, fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: false,
    }),
  );

  const treeView = window.createTreeView('bigArchiveExplorer', {
    treeDataProvider,
    dragAndDropController: new BigDragAndDropController(archives),
    showCollapseAll: true,
    canSelectMany: true,
  });

  context.subscriptions.push(treeView);

  const registerNodeCommand = createNodeCommandRegister(context, treeView);

  registerFileCommands(registerNodeCommand, archives);
  registerExtractCommands(registerNodeCommand, archives);
  registerClipboardCommands(registerNodeCommand, archives);
  context.subscriptions.push(
    ...registerModCommands(registerNodeCommand, archives),
    commands.registerCommand('bigfs.refreshArchives', async () => {
      await setContextKey('scanned', false);

      try {
        await archives.scanWorkspace();
        // Loose files are only found when the game view is built
        gameView.invalidate();
      } finally {
        treeDataProvider.refresh();
        await markScanned();
      }
    }),
    workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme === SCHEME) {
        window.setStatusBarMessage(
          `BIG archive updated: ${document.uri.path}`,
          4000,
        );
      }
    }),
  );
};
