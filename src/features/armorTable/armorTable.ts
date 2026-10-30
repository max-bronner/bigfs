import * as vscode from 'vscode';
import { webviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { createDebouncer } from '../../core/debounce';
import {
  armorEdit,
  armorValue,
  damageTypes,
  readArmorRows,
} from '../../game/objects/armorTable';
import type {
  ArmorRow,
  ArmorTableMessage,
  FromArmorPage,
} from '../../game/objects/armorTable';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import { registerCommand } from '../../platform/commands';

/**
 * **Armor Table**: every armor in the workspace and its archives against
 * every damage type any of them names, in one grid. A cell is what the
 * armor lets through of that damage; one the armor does not write shows
 * its DEFAULT, greyed. Typing in a cell writes that armor's line, or adds
 * the line when it has none.
 */

/** Milliseconds after an edit before the table is read again */
const REFRESH_DELAY = 300;

const createArmorTable = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
) => {
  let rows: ArmorRow[] = [];

  const scripts = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const refreshSoon = createDebouncer(() => void refresh(), REFRESH_DELAY);
  const panel = createSingletonPanel<FromArmorPage, ArmorTableMessage>({
    viewType: 'bigfs.armorTable',
    title: 'Armor Table',
    column: vscode.ViewColumn.Active,
    options: {
      enableScripts: true,
      localResourceRoots: [scripts],
      retainContextWhenHidden: true,
    },
    render: ({ webview }) => {
      webview.html = webviewPage({
        allow: { script: webview.cspSource },
        scriptFiles: [
          webview
            .asWebviewUri(vscode.Uri.joinPath(scripts, 'armor.js'))
            .toString(),
        ],
        style: `
body { color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); margin: 0; padding: 8px 12px; }
#filter { margin-bottom: 8px; width: 260px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; }
.wrap { overflow: auto; max-height: calc(100vh - 60px); }
table { border-collapse: collapse; font-size: 12px; }
th, td { border: 1px solid var(--vscode-panel-border, #444); padding: 0; }
th { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 3px 6px; font-weight: 600; z-index: 1; }
td.name { position: sticky; left: 0; background: var(--vscode-editor-background); padding: 2px 6px; white-space: nowrap; cursor: pointer; }
td input { width: 56px; border: none; background: transparent; color: inherit; text-align: right; padding: 2px 4px; font: inherit; }
td input.inherited { opacity: 0.45; font-style: italic; }
td input:focus { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-input-background); }
td.low { background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 25%, transparent); }
td.high { background: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 25%, transparent); }
.muted { opacity: 0.7; }
`,
        body: `<input id="filter" placeholder="Filter armors"> <span id="summary" class="muted"></span><div class="wrap"><table id="table"></table></div>`,
      });
      return [
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (rows.some((row) => row.uri === event.document.uri.toString())) {
            refreshSoon.schedule();
          }
        }),
        { dispose: refreshSoon.cancel },
      ];
    },
    onMessage: (message) => receive(message),
  });

  /** Reads every armor the index knows and sends the table */
  const refresh = async (): Promise<ArmorTableMessage> => {
    await index.whenReady();

    const schema = await documents.getSchema();
    const files = new Map<string, vscode.Uri>();

    for (const name of index.getNames('Armor')) {
      for (const place of index.findDefinitions('Armor', name)) {
        files.set(place.uri.toString(), place.uri);
      }
    }

    const read: ArmorRow[] = [];

    for (const uri of files.values()) {
      const lines = (await readWorkspaceText(uri)).split(/\r?\n/);

      read.push(
        ...readArmorRows(parseSageIni(lines, schema), lines, uri.toString()),
      );
    }
    // A later definition of a name replaces an earlier one; keep one row each
    const byName = new Map(read.map((row) => [row.name.toLowerCase(), row]));

    rows = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

    const message: ArmorTableMessage = {
      kind: 'table',
      types: damageTypes(rows),
      rows: rows,
    };

    await panel.post(message);
    return message;
  };

  const stale = async (): Promise<void> => {
    void vscode.window.showErrorMessage(
      'The file changed since the table was built; it has been refreshed',
    );
    await refresh();
  };

  const receive = async (message: FromArmorPage): Promise<void> => {
    if (message.kind === 'ready') {
      await refresh();
      return;
    }

    const row = rows.find(
      (each) => each.name.toLowerCase() === message.armor.toLowerCase(),
    );

    if (!row) {
      return;
    }

    const uri = vscode.Uri.parse(row.uri);

    if (message.kind === 'reveal') {
      const editor = await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Beside,
      });
      const at = new vscode.Position(row.startLine, 0);

      editor.selection = new vscode.Selection(at, at);
      editor.revealRange(new vscode.Range(at, at));
      return;
    }

    const value = armorValue(message.value);

    if (!value) {
      void vscode.window.showErrorMessage(
        `${message.value} is not a percentage`,
      );
      await refresh();
      return;
    }

    // The table may be up to 300 ms behind the file: the lines it would
    // edit must still read as the table saw them
    const document = await vscode.workspace.openTextDocument(uri);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const change = armorEdit(row, message.type.toUpperCase(), value, eol);
    const edit = new vscode.WorkspaceEdit();

    if (change.kind === 'replace') {
      const range = new vscode.Range(
        change.line,
        change.start,
        change.line,
        change.end,
      );

      if (
        change.line >= document.lineCount ||
        document.getText(range) !== change.old
      ) {
        await stale();
        return;
      }
      edit.replace(uri, range, value);
    } else {
      const anchor = Math.min(row.endLine, document.lineCount - 1);

      if (
        row.startLine >= document.lineCount ||
        !/^\s*armor\b/i.test(document.lineAt(row.startLine).text) ||
        (change.line === row.endLine &&
          !/^\s*end\b/i.test(document.lineAt(anchor).text))
      ) {
        await stale();
        return;
      }
      edit.insert(uri, new vscode.Position(change.line, 0), change.text);
    }
    await vscode.workspace.applyEdit(edit);
    await refresh();
  };

  return { show: panel.show, refresh, receive };
};

/** Registers `bigfs.showArmorTable`, which opens the armor table and, given a message, acts on it as the page would */
export const registerArmorTable = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable => {
  const table = createArmorTable(context, documents, index);

  return registerCommand(
    'bigfs.showArmorTable',
    async (message?: FromArmorPage) => {
      table.show();

      // Automation acts as the page
      if (message) {
        await table.receive(message);
      }
      return table.refresh();
    },
  );
};
