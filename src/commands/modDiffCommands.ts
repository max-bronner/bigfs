import * as vscode from 'vscode';
import { getGameFiles } from '../model/gameView';
import type { GameViewModel } from '../model/gameViewModel';
import { getNodeUri } from '../model/nodeAddress';
import {
  BaseIndex,
  ComparedFile,
  compareWithBase,
  indexBaseGame,
  readBaseEntry,
} from '../model/modDiff';
import { createNonce } from '../providers/webviewNonce';
import { decodeWindows1252 } from '../common/windows1252';

/**
 * **Compare with Base Game**: what the workspace's mod adds and changes
 * against an untouched install, file by file, after both sides' load order,
 * with a diff for each changed file.
 */

const BASE_SETTING = 'bigfs.baseGameFolder';
const BASE_SCHEME = 'bigfs-base';

/** File types a text diff makes sense for */
const TEXT_FILES = /\.(ini|inc|bhav|str|wnd|txt|lua|xml|cfg|scb|csv)$/i;

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

const renderReport = (
  results: ComparedFile[],
  folder: string,
  archives: number,
  unreadable: string[],
): string => {
  const nonce = createNonce();
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
          }<button data-action="open">Open</button></td></tr>`,
      )
      .join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { padding: 8px 16px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 4px; }
  table { border-collapse: collapse; width: 100%; } td { padding: 2px 6px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.path { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; } td.actions { white-space: nowrap; text-align: right; }
  button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; margin-left: 4px; cursor: pointer; }
  summary { cursor: pointer; font-weight: bold; margin: 10px 0 4px; } .muted { opacity: 0.7; }
</style></head><body>
<h2>Mod against the base game</h2>
<p class="muted">Base: ${escape(folder)} (${archives} archives${unreadable.length ? `, ${unreadable.length} unreadable: ${escape(unreadable.join(', '))}` : ''})</p>
<input id="filter" placeholder="Filter by path">
${groups
  .map(
    ([key, title, files]) =>
      `<details ${key === 'same' ? '' : 'open'} data-group="${key}"><summary>${title} (${files.length})</summary><table>${rows(files)}</table></details>`,
  )
  .join('')}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('filter').addEventListener('input', (event) => {
    const text = event.target.value.toLowerCase();
    document.querySelectorAll('tr[data-path]').forEach((row) => { row.hidden = text && !row.dataset.path.toLowerCase().includes(text); });
  });
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) vscode.postMessage({ action: button.dataset.action, path: button.closest('tr').dataset.path });
  });
</script></body></html>`;
};

export const registerModDiffCommands = (
  context: vscode.ExtensionContext,
  gameView: GameViewModel,
): void => {
  let base: { folder: string; index: BaseIndex } | undefined;

  const baseFolder = async (): Promise<string | undefined> => {
    const configured = vscode.workspace
      .getConfiguration()
      .get<string>(BASE_SETTING);

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
      await vscode.workspace
        .getConfiguration()
        .update(BASE_SETTING, picked.fsPath, vscode.ConfigurationTarget.Global);
    }

    return picked?.fsPath;
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const entry = base?.index.get(
          uri.path.replace(/^\//, '').toLowerCase(),
        );

        return entry ? decodeWindows1252(await readBaseEntry(entry)) : '';
      },
    }),
    vscode.commands.registerCommand('bigfs.compareWithBaseGame', async () => {
      const folder = await baseFolder();

      if (!folder) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Comparing with the base game',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'reading the base game' });

          const indexed = await indexBaseGame(folder);

          base = { folder, index: indexed.index };

          const files = getGameFiles(await gameView.getRoot()).flatMap(
            (node) => {
              const winner = node.winner;

              if (!winner) {
                return [];
              }

              const uri =
                winner.ref.kind === 'entry'
                  ? getNodeUri(winner.ref.node)
                  : winner.ref.uri;

              return [{ entryPath: winner.entryPath.replace(/\\/g, '/'), uri }];
            },
          );
          const sized = await Promise.all(
            files.map(async (file) => ({
              ...file,
              size: (await vscode.workspace.fs.stat(file.uri)).size,
              read: () => vscode.workspace.fs.readFile(file.uri),
            })),
          );
          const results = await compareWithBase(sized, indexed.index, (done) =>
            progress.report({ message: `${done} of ${sized.length} files` }),
          );
          const byPath = new Map(
            files.map((file) => [file.entryPath, file.uri]),
          );
          const panel = vscode.window.createWebviewPanel(
            'bigfs.modDiff',
            'Mod against Base Game',
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [] },
          );

          panel.webview.html = renderReport(
            results,
            folder,
            indexed.archives,
            indexed.unreadable,
          );
          panel.webview.onDidReceiveMessage(
            async (message: { action: string; path: string }) => {
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
            },
          );
        },
      );
    }),
  );
};
