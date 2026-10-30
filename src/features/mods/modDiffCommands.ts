import * as vscode from 'vscode';
import { getGameFiles } from '../../game/install/gameView';
import type { GameViewModel } from '../../services/archives/gameViewModel';
import { getNodeUri } from '../../services/archives/nodeAddress';
import {
  BaseIndex,
  ComparedFile,
  ModFile,
  compareWithBase,
  indexBaseGame,
  readBaseEntry,
} from '../../node/modDiff';
import { findBaseGameFolders } from '../../services/archives/baseGameFolders';
import {
  packedArchives,
  useOutputStore,
} from '../../services/archives/packagedOutputs';
import type { FromModDiffPage } from '../../webview/mods/protocol';
import { webviewPage } from '../../platform/webview/webviewPage';
import { registerPackageMod } from './packageModCommand';
import { decodeIniText } from '../../core/windows1252';
import { diffDefinitions } from '../../game/objects/definitionDiff';
import type { DefinitionDiff } from '../../game/objects/definitionDiff';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { settings } from '../../platform/settings';
import { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';

/**
 * **Compare with Base Game**: what the workspace's mod adds and changes
 * against an untouched install, file by file, after both sides' load order,
 * with a diff for each changed file.
 */

const BASE_SCHEME = 'bigfs-base';

/** File types a text diff makes sense for */
const TEXT_FILES = /\.(ini|inc|bhav|str|wnd|txt|lua|xml|cfg|scb|csv)$/i;

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Renders a changed INI file's definition changes as HTML lines of the report */
const definitionLines = (diff: DefinitionDiff): string[] => {
  const shown = (value?: string) => (value === undefined ? '∅' : value);

  return [
    ...diff.added.map((name) => `<span class="add">+ ${escape(name)}</span>`),
    ...diff.removed.map((name) => `<span class="del">− ${escape(name)}</span>`),
    ...diff.changed.map(
      ({ name, changes }) =>
        `<b>${escape(name)}</b>: ${changes
          .map(
            (change) =>
              `<code>${escape(change.path)}</code> ${escape(shown(change.before))} → ${escape(shown(change.after))}`,
          )
          .join('; ')}`,
    ),
  ];
};

/** Definition changes listed under a file before the rest are left to its Diff */
const MAX_DEFINITIONS = 60;

const renderReport = (
  webview: vscode.Webview,
  scripts: vscode.Uri,
  results: ComparedFile[],
  folder: string,
  archives: number,
  unreadable: string[],
  definitions: ReadonlyMap<string, DefinitionDiff> = new Map(),
): string => {
  const groups: [string, string, ComparedFile[]][] = [
    ['changed', 'Changed', results.filter((file) => file.change === 'changed')],
    ['added', 'Added', results.filter((file) => file.change === 'added')],
    [
      'same',
      'Same as the base game',
      results.filter((file) => file.change === 'same'),
    ],
  ];
  const rows = (files: ComparedFile[]) =>
    files
      .map(
        (file) =>
          `<tr data-path="${escape(file.entryPath)}"><td class="path">${escape(file.entryPath)}</td><td>${file.baseSize === undefined ? '' : `${file.baseSize.toLocaleString()} → `}${file.size.toLocaleString()} bytes</td><td class="actions">${
            file.change === 'changed' && TEXT_FILES.test(file.entryPath)
              ? '<button data-action="diff">Diff</button>'
              : ''
          }<button data-action="open">Open</button></td></tr>${(() => {
            const diff = definitions.get(file.entryPath);
            const lines = diff ? definitionLines(diff) : [];

            return lines.length
              ? `<tr class="defs" data-path="${escape(file.entryPath)}"><td colspan="3">${lines
                  .slice(0, MAX_DEFINITIONS)
                  .join(
                    '<br>',
                  )}${lines.length > MAX_DEFINITIONS ? `<br><span class="muted">and ${lines.length - MAX_DEFINITIONS} more: use Diff</span>` : ''}</td></tr>`
              : '';
          })()}`,
      )
      .join('');

  return webviewPage({
    allow: { script: webview.cspSource },
    scriptFiles: [
      webview
        .asWebviewUri(vscode.Uri.joinPath(scripts, 'modDiff.js'))
        .toString(),
    ],
    style: `
  body { padding: 8px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 4px; }
  table { border-collapse: collapse; width: 100%; } td { padding: 2px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.path { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; } td.actions { white-space: nowrap; text-align: right; }
  button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; margin-left: 4px; cursor: pointer; }
  summary { cursor: pointer; font-weight: bold; margin: 10px 0 4px; } .muted { opacity: 0.7; }
  tr.defs td { padding: 2px 6px 8px 24px; font-size: 12px; } tr.defs code { opacity: 0.85; }
  .add { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); } .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
`,
    body: `<h2>Mod against the base game</h2>
<p class="muted">Base: ${escape(folder)} (${archives} archives${unreadable.length ? `, ${unreadable.length} unreadable: ${escape(unreadable.join(', '))}` : ''})</p>
<input id="filter" placeholder="Filter by path">
${groups
  .map(
    ([key, title, files]) =>
      `<details ${key === 'same' ? '' : 'open'} data-group="${key}"><summary>${title} (${files.length})</summary><table>${rows(files)}</table></details>`,
  )
  .join('')}`,
  });
};

/**
 * Registers `bigfs.compareWithBaseGame`, the read-only `bigfs-base` documents
 * its diffs open, and the package command that shares its base game lookup
 */
export const registerModDiffCommands = (
  context: vscode.ExtensionContext,
  gameView: GameViewModel,
): void => {
  let base: { folder: string; index: BaseIndex } | undefined;
  const documents = new SageIniDocuments(context.extensionUri);
  const scripts = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');

  context.subscriptions.push(documents);
  useOutputStore(context.globalState);

  const baseFolder = async (): Promise<string | undefined> => {
    const configured = settings.baseGameFolder.get();

    if (configured) {
      return configured;
    }

    const [picked] =
      (await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: 'Use as Base Game',
        title: 'The install folder of the unmodded game',
      })) ?? [];

    if (picked) {
      await settings.baseGameFolder.update(
        picked.fsPath,
        vscode.ConfigurationTarget.Global,
      );
    }

    return picked?.fsPath;
  };

  /** Lists the base game's installs, the highest layer first; asks for a folder when none is set */
  const baseLayers = async (): Promise<string[]> =>
    (await baseFolder()) ? findBaseGameFolders() : [];

  const compare = (folders: string[]): Thenable<void> =>
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Comparing with the base game',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'reading the base game' });

        const indexed = await indexBaseGame(folders, {
          exclude: packedArchives(),
        });
        const folder = folders.join(', ');

        base = { folder, index: indexed.index };

        // What the mod gives the game: the winners of the view that are not
        // the base game's own, whichever layer of it they sit in
        const files = getGameFiles(await gameView.getRoot()).flatMap((node) => {
          const winner = node.winner;

          if (!winner || winner.ref.base) {
            return [];
          }

          const uri =
            winner.ref.kind === 'entry'
              ? getNodeUri(winner.ref.node)
              : winner.ref.uri;

          return [{ entryPath: winner.entryPath.replace(/\\/g, '/'), uri }];
        });
        const sized: ModFile[] = [];

        for (const file of files) {
          try {
            sized.push({
              entryPath: file.entryPath,
              size: (await vscode.workspace.fs.stat(file.uri)).size,
              read: () => vscode.workspace.fs.readFile(file.uri),
            });
          } catch {
            // Gone since the view was built, such as a loose file deleted
            // meanwhile: it is no longer part of the mod
          }
        }

        const results = await compareWithBase(
          sized,
          indexed.index,
          (done) =>
            progress.report({ message: `${done} of ${sized.length} files` }),
          () => token.isCancellationRequested,
        );

        if (token.isCancellationRequested) {
          return;
        }

        const byPath = new Map(files.map((file) => [file.entryPath, file.uri]));

        progress.report({ message: 'comparing definitions' });

        // What each changed INI file changes, definition by definition
        const schema = await documents.getSchema();
        const definitions = new Map<string, DefinitionDiff>();

        for (const file of results) {
          if (token.isCancellationRequested) {
            return;
          }

          const entry = indexed.index.get(file.entryPath.toLowerCase());
          const modUri = byPath.get(file.entryPath);

          if (
            file.change !== 'changed' ||
            !entry ||
            !modUri ||
            !/\.ini$/i.test(file.entryPath)
          ) {
            continue;
          }

          const read = (bytes: Uint8Array) => {
            const lines = decodeIniText(bytes).split(/\r?\n/);

            return { document: parseSageIni(lines, schema), lines };
          };

          try {
            definitions.set(
              file.entryPath,
              diffDefinitions(
                read(await readBaseEntry(entry)),
                read(await vscode.workspace.fs.readFile(modUri)),
              ),
            );
          } catch {
            // A file that does not read keeps its plain Diff button
          }
        }

        const panel = vscode.window.createWebviewPanel(
          'bigfs.modDiff',
          'Mod against Base Game',
          vscode.ViewColumn.Active,
          { enableScripts: true, localResourceRoots: [scripts] },
        );

        panel.webview.html = renderReport(
          panel.webview,
          scripts,
          results,
          folder,
          indexed.archives,
          indexed.unreadable,
          definitions,
        );
        panel.webview.onDidReceiveMessage(async (message: FromModDiffPage) => {
          const modUri = byPath.get(message.path);

          if (!modUri) {
            return;
          }

          if (message.action === 'diff') {
            await vscode.commands.executeCommand(
              'vscode.diff',
              vscode.Uri.from({
                scheme: BASE_SCHEME,
                path: `/${message.path}`,
              }),
              modUri,
              `${message.path.slice(message.path.lastIndexOf('/') + 1)} (base ↔ mod)`,
            );
          } else {
            await vscode.commands.executeCommand('vscode.open', modUri);
          }
        });
      },
    );

  context.subscriptions.push(
    registerPackageMod(baseLayers, documents),
    vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const entry = base?.index.get(
          uri.path.replace(/^\//, '').toLowerCase(),
        );

        return entry ? decodeIniText(await readBaseEntry(entry)) : '';
      },
    }),
    registerCommand('bigfs.compareWithBaseGame', async () => {
      const folders = await baseLayers();

      if (!folders.length) {
        void vscode.window.showWarningMessage(
          'No base game folder is set, or it cannot be read (bigfs.baseGameFolder).',
        );
        return;
      }

      try {
        await compare(folders);
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Comparing with the base game failed: ${describeError(error)}`,
        );
      }
    }),
  );
};
