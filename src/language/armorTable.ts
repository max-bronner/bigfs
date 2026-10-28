import * as vscode from 'vscode';
import { webviewPage } from '../platform/webview/webviewPage';
import {
  armorEdit,
  armorValue,
  damageTypes,
  readArmorRows,
} from '../game/objects/armorTable';
import type {
  ArmorRow,
  ArmorTableMessage,
  FromArmorPage,
} from '../game/objects/armorTable';
import { parseSageIni } from '../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../services/ini/sageIniIndex';
import { readWorkspaceText } from '../services/ini/workspaceText';

/**
 * **Armor Table**: every armor in the workspace and its archives against
 * every damage type any of them names, in one grid. A cell is what the
 * armor lets through of that damage; one the armor does not write shows
 * its DEFAULT, greyed. Typing in a cell writes that armor's line, or adds
 * the line when it has none.
 */

class ArmorTable {
  private static current?: ArmorTable;
  private rows: ArmorRow[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  public static show(
    context: vscode.ExtensionContext,
    documents: SageIniDocuments,
    index: SageIniIndex,
  ): ArmorTable {
    if (ArmorTable.current) {
      ArmorTable.current.panel.reveal();
      return ArmorTable.current;
    }
    ArmorTable.current = new ArmorTable(context, documents, index);
    return ArmorTable.current;
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    context: vscode.ExtensionContext,
    private readonly documents: SageIniDocuments,
    private readonly index: SageIniIndex,
  ) {
    const scripts = vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      'webview',
    );

    this.panel = vscode.window.createWebviewPanel(
      'bigfs.armorTable',
      'Armor Table',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [scripts],
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = webviewPage({
      allow: { script: this.panel.webview.cspSource },
      scriptFiles: [
        this.panel.webview
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
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: FromArmorPage) =>
        this.receive(message),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          this.rows.some((row) => row.uri === event.document.uri.toString())
        ) {
          this.refreshSoon();
        }
      }),
    );
    this.panel.onDidDispose(() => {
      ArmorTable.current = undefined;
      this.disposables.forEach((each) => each.dispose());
    });
  }

  private refreshSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 300);
  }

  /** Reads every armor the index knows and sends the table */
  public async refresh(): Promise<ArmorTableMessage> {
    await this.index.whenReady();

    const schema = await this.documents.getSchema();
    const files = new Map<string, vscode.Uri>();

    for (const name of this.index.getNames('Armor')) {
      for (const place of this.index.findDefinitions('Armor', name)) {
        files.set(place.uri.toString(), place.uri);
      }
    }

    const rows: ArmorRow[] = [];

    for (const uri of files.values()) {
      const lines = (await readWorkspaceText(uri)).split(/\r?\n/);

      rows.push(
        ...readArmorRows(parseSageIni(lines, schema), lines, uri.toString()),
      );
    }
    // A later definition of a name replaces an earlier one; keep one row each
    const byName = new Map(rows.map((row) => [row.name.toLowerCase(), row]));

    this.rows = [...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const message: ArmorTableMessage = {
      kind: 'table',
      types: damageTypes(this.rows),
      rows: this.rows,
    };

    await this.panel.webview.postMessage(message);
    return message;
  }

  private async stale(): Promise<void> {
    void vscode.window.showErrorMessage(
      'The file changed since the table was built; it has been refreshed',
    );
    await this.refresh();
  }

  public async receive(message: FromArmorPage): Promise<void> {
    if (message.kind === 'ready') {
      await this.refresh();
      return;
    }

    const row = this.rows.find(
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
      await this.refresh();
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
        await this.stale();
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
        await this.stale();
        return;
      }
      edit.insert(uri, new vscode.Position(change.line, 0), change.text);
    }
    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }
}

export const registerArmorTable = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.showArmorTable',
    async (message?: FromArmorPage) => {
      const table = ArmorTable.show(context, documents, index);

      // Automation acts as the page
      if (message) {
        await table.receive(message);
      }
      return table.refresh();
    },
  );
