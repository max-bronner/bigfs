import * as vscode from 'vscode';
import { ArchiveModel } from './model/archiveModel';
import { BigFileSystemProvider } from './providers/fileSystemProvider';
import {
  BigTreeDataProvider,
  VIEW_SETTING,
  isGameViewShown,
} from './providers/treeDataProvider';
import { GameViewModel } from './model/gameViewModel';
import { BigDragAndDropController } from './providers/dragAndDropController';
import { createNodeCommandRegister } from './commands/commandCenter';
import { registerFileCommands } from './commands/fileCommands';
import { registerExtractCommands } from './commands/extractCommands';
import { registerClipboardCommands } from './commands/clipboardCommands';
import { registerModCommands } from './commands/modCommands';
import { createToolRegistry } from './tools/toolRegistry';
import { createFormatRegistry } from './formats/formatRegistry';
import { registerSageIniLanguage } from './language/sageIniLanguage';
import { registerSageStrLanguage } from './language/sageStrLanguage';
import { registerSageWndLanguage } from './language/sageWndLanguage';
import { registerTextureCommands } from './commands/textureCommands';
import { PreviewEditorProvider } from './providers/previewEditorProvider';
import { AptEditorProvider } from './providers/aptEditorProvider';
import { MapEditorProvider } from './providers/mapEditorProvider';
import {
  CSF_VIEW_TYPE,
  CsfEditorProvider,
  STR_TABLE_VIEW_TYPE,
  StrTableEditorProvider,
} from './providers/stringTableEditorProvider';
import { decodeDdsTool, decodeTgaTool } from './tools/textureTools';
import { playableAudioTool } from './tools/audioTools';
import { parseW3dTool } from './tools/w3dTools';
import { EntryLocator } from './formats/entryLocator';
import { SCHEME } from './constants';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('bigFS', { log: true });
  const archiveModel = new ArchiveModel(log);

  context.subscriptions.push(log, archiveModel);

  // scanned and hasArchives gate the welcome views declared in package.json
  const setContextKey = (key: string, value: boolean) =>
    vscode.commands.executeCommand('setContext', `${SCHEME}.${key}`, value);

  const markScanned = async () => {
    await setContextKey(
      'hasArchives',
      archiveModel.getArchiveRoots().length > 0,
    );
    await setContextKey('scanned', true);
  };

  // not awaited: activation returns before the scan does, and the tree is
  // usable while it runs
  archiveModel.whenReady().finally(markScanned);

  // Registering a tool or a format is one line here
  const tools = createToolRegistry();
  const formats = createFormatRegistry(archiveModel, tools);

  tools.register(decodeTgaTool, decodeDdsTool, playableAudioTool, parseW3dTool);
  formats.register();

  const locator = new EntryLocator(archiveModel);

  context.subscriptions.push(
    locator,
    PreviewEditorProvider.register(tools, locator),
    AptEditorProvider.register(tools, locator),
    MapEditorProvider.register(),
  );

  registerSageIniLanguage(context, archiveModel, log);
  registerSageStrLanguage(context);
  registerSageWndLanguage(context);
  registerTextureCommands(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      STR_TABLE_VIEW_TYPE,
      new StrTableEditorProvider(),
    ),
    vscode.window.registerCustomEditorProvider(
      CSF_VIEW_TYPE,
      new CsfEditorProvider(),
      { supportsMultipleEditorsPerDocument: true },
    ),
    vscode.commands.registerCommand(
      'bigfs.openStringTable',
      (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;

        return target
          ? vscode.commands.executeCommand(
              'vscode.openWith',
              target,
              STR_TABLE_VIEW_TYPE,
            )
          : undefined;
      },
    ),
  );

  const fileSystemProvider = new BigFileSystemProvider(archiveModel);
  const gameView = new GameViewModel(archiveModel);
  const treeDataProvider = new BigTreeDataProvider(archiveModel, gameView);

  // The context key picks which of the two view buttons the title bar shows
  const showView = (isGame: boolean) =>
    vscode.workspace
      .getConfiguration()
      .update(
        VIEW_SETTING,
        isGame ? 'game' : 'archives',
        vscode.ConfigurationTarget.Workspace,
      );

  void setContextKey('gameView', isGameViewShown());
  context.subscriptions.push(
    gameView,
    vscode.commands.registerCommand(`${SCHEME}.showGameView`, () =>
      showView(true),
    ),
    vscode.commands.registerCommand(`${SCHEME}.showArchiveView`, () =>
      showView(false),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(VIEW_SETTING)) {
        void setContextKey('gameView', isGameViewShown());
        treeDataProvider.refresh();
      }
    }),
  );
  const dragAndDropController = new BigDragAndDropController(archiveModel);

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, fileSystemProvider, {
      isCaseSensitive: false,
      isReadonly: false,
    }),
  );

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
  context.subscriptions.push(
    ...registerModCommands(registerNodeCommand, archiveModel),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${SCHEME}.refreshArchives`, async () => {
      await setContextKey('scanned', false);

      try {
        await archiveModel.scanWorkspace();
        // Loose files are only found when the game view is built
        gameView.invalidate();
      } finally {
        treeDataProvider.refresh();
        await markScanned();
      }
    }),
  );

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

/**
 * Shutdown hook VS Code calls when the extension is unloaded. Empty because
 * everything `activate` registers is disposed through `context.subscriptions`.
 */
export function deactivate() {}
