import { window } from 'vscode';
import type { ExtensionContext, LogOutputChannel } from 'vscode';
import { ArchiveModel } from '../model/archiveModel';
import { GameViewModel } from '../model/gameViewModel';
import { EntryLocator } from '../formats/entryLocator';
import { createToolRegistry } from '../tools/toolRegistry';
import type { ToolBox } from '../tools/toolRegistry';
import { decodeDdsTool, decodeTgaTool } from '../tools/textureTools';
import { playableAudioTool } from '../tools/audioTools';
import { parseW3dTool } from '../tools/w3dTools';
import { SageIniDocuments } from '../language/sageIniDocuments';
import { SageIniIndex } from '../language/sageIniIndex';
import { GameLanguage } from '../language/gameLanguage';

/**
 * The long-lived host services every feature is handed, built once at
 * activation and disposed with the extension.
 */
export interface Services {
  /** The `bigFS` output channel */
  log: LogOutputChannel;
  /** Every archive in the workspace and the configured game folders */
  archives: ArchiveModel;
  /** Which file the game would load for a path, kept current as archives change */
  gameView: GameViewModel;
  /** Finds a skeleton, texture or other asset named by file name only */
  locator: EntryLocator;
  /** The pure decoders the previews run */
  tools: ToolBox;
  /** Parses each open INI document once per edit, shared by every INI feature */
  iniDocuments: SageIniDocuments;
  /** Definitions, uses and macros across every archive */
  iniIndex: SageIniIndex;
  /** The localisation language string lookups resolve in */
  gameLanguage: GameLanguage;
}

/**
 * Creates the services `extension.ts` hands to every feature, and starts the
 * work that has to run before the first request: the archive scan, the INI
 * index and the language choice. None of it is awaited, so activation returns
 * while it runs.
 */
export const createServices = (context: ExtensionContext): Services => {
  const log = window.createOutputChannel('bigFS', { log: true });
  const archives = new ArchiveModel(log);
  const tools = createToolRegistry();

  tools.register(decodeTgaTool, decodeDdsTool, playableAudioTool, parseW3dTool);

  const gameView = new GameViewModel(archives);
  const locator = new EntryLocator(archives, gameView);
  const iniDocuments = new SageIniDocuments(context.extensionUri);
  const iniIndex = new SageIniIndex(
    archives,
    () => iniDocuments.getSchema(),
    log,
  );
  const gameLanguage = new GameLanguage(
    archives,
    context.workspaceState,
    iniIndex,
  );

  context.subscriptions.push(
    log,
    archives,
    locator,
    iniDocuments,
    iniIndex,
    // Another game reads some lines differently, so every file is read again
    iniDocuments.onDidChangeSchema(() => iniIndex.reset()),
    gameLanguage,
    gameView,
  );

  // Built up front rather than on the first navigation. Reading a full
  // install takes a few seconds, and a provider that slow is cancelled by the
  // editor before it answers - which reads as ctrl-click doing nothing.
  archives
    .whenReady()
    .then(() => iniIndex.whenReady())
    .catch((error: unknown) => log.error('Failed to index INI entries', error));

  // Settled once the archives are indexed, so hovers and diagnostics read
  // text in the chosen language; asks only when several are installed
  void archives
    .whenReady()
    .then(() => gameLanguage.ensure())
    .catch((error: unknown) => log.error('Failed to settle language', error));

  return {
    log,
    archives,
    gameView,
    locator,
    tools,
    iniDocuments,
    iniIndex,
    gameLanguage,
  };
};
