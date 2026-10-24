import * as vscode from 'vscode';
import { decodeWindows1252 } from '../common/windows1252';
import { createNonce } from '../providers/webviewNonce';
import { BALANCE_SHEET_SCRIPT } from './balanceSheetScript';
import {
  STAT_COLUMNS,
  readObjectStats,
  readWeaponStats,
} from './model/objectStats';
import type { ObjectStats, StatColumn, StatValue } from './model/objectStats';
import {
  forEachBlock,
  parseSageIni,
  isFragmentPath,
} from './model/sageIniParser';
import type { SageBlock, SageDocument } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import type { SageIniIndex } from './sageIniIndex';

/**
 * The balance sheet: every unit and building with its cost, build time,
 * command points, health, vision, speed and primary weapon in one sortable
 * table. A value written in the object, or in the weapon it fires, is
 * edited in place; a value a child inherits is shown with where it comes
 * from and edited at its parent.
 */

const OBJECT_KEYWORDS = ['Object', 'ChildObject', 'ObjectReskin'];
const WEAPON_COLUMNS = ['damage', 'range', 'delay'] as const;
const MAX_PARENTS = 16;

export interface SheetCell {
  value: string;
  /** Where the value is written; absent when nothing writes it */
  uri?: string;
  line?: number;
  start?: number;
  end?: number;
  /** The template it is inherited from */
  from?: string;
  /** How many rows read this same weapon value */
  shared?: number;
}

export interface SheetRow {
  name: string;
  keyword: string;
  parent?: string;
  uri: string;
  line: number;
  selectable: boolean;
  cells: Partial<Record<StatColumn, SheetCell>>;
}

const cellOf = (uri: string, value: StatValue, from?: string): SheetCell => ({
  value: value.value,
  uri,
  line: value.line,
  start: value.start,
  end: value.end,
  from,
});

class BalanceSheet {
  private static current?: BalanceSheet;
  private readonly panel: vscode.WebviewPanel;
  private readonly parses = new Map<string, Promise<SageDocument>>();
  private readonly disposables: vscode.Disposable[] = [];
  public rows: SheetRow[] = [];

  public static show(
    documents: SageIniDocuments,
    index: SageIniIndex,
  ): BalanceSheet {
    if (BalanceSheet.current) {
      BalanceSheet.current.panel.reveal();
    } else {
      BalanceSheet.current = new BalanceSheet(documents, index);
    }
    return BalanceSheet.current;
  }

  private constructor(
    private readonly documents: SageIniDocuments,
    private readonly index: SageIniIndex,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'bigfs.balanceSheet',
      'Balance Sheet',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = renderHtml();
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) =>
        this.receive(message).catch((error: unknown) =>
          this.panel.webview.postMessage({
            kind: 'notice',
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        this.parses.delete(document.uri.toString()),
      ),
    );
    this.panel.onDidDispose(() => {
      BalanceSheet.current = undefined;
      this.disposables.forEach((disposable) => disposable.dispose());
    });
  }

  private loaded?: Promise<void>;

  /** Resolves once the table has been built and sent at least once */
  public whenLoaded(): Promise<void> {
    return this.loaded ?? Promise.resolve();
  }

  public async receive(message: {
    kind?: string;
    uri?: string;
    line?: number;
    start?: number;
    end?: number;
    value?: string;
    old?: string;
  }): Promise<void> {
    switch (message?.kind) {
      case 'ready':
        this.loaded = this.refresh();
        await this.loaded;
        break;
      case 'refresh':
        this.parses.clear();
        await this.refresh();
        break;
      case 'open': {
        const editor = await vscode.window.showTextDocument(
          vscode.Uri.parse(String(message.uri)),
          { viewColumn: vscode.ViewColumn.Beside },
        );
        const at = new vscode.Position(Number(message.line) || 0, 0);

        editor.selection = new vscode.Selection(at, at);
        editor.revealRange(new vscode.Range(at, at));
        break;
      }
      case 'edit':
        await this.edit(message);
        break;
    }
  }

  /** Writes one value where it is written, and saves a file that was clean */
  private async edit(change: {
    uri?: string;
    line?: number;
    start?: number;
    end?: number;
    value?: string;
    old?: string;
  }): Promise<void> {
    const value = String(change.value ?? '').trim();

    if (!change.uri || !value || /\s/.test(value)) {
      throw new Error('A value is one word or number');
    }

    const uri = vscode.Uri.parse(change.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(
      Number(change.line),
      Number(change.start),
      Number(change.line),
      Number(change.end),
    );

    if (document.getText(range) !== change.old) {
      this.parses.delete(uri.toString());
      await this.refresh();
      throw new Error(
        'The file changed since the table was built; it has been refreshed',
      );
    }

    const wasDirty = document.isDirty;
    const edit = new vscode.WorkspaceEdit();

    edit.replace(uri, range, value);
    await vscode.workspace.applyEdit(edit);
    if (!wasDirty) {
      await document.save();
    }
    this.parses.delete(uri.toString());
    await this.refresh();
  }

  private parse(uri: vscode.Uri): Promise<SageDocument> {
    const key = uri.toString();
    let parse = this.parses.get(key);

    if (!parse) {
      parse = (async () => {
        const open = vscode.workspace.textDocuments.find(
          (document) => document.uri.toString() === key,
        );
        const text =
          open?.getText() ??
          decodeWindows1252(await vscode.workspace.fs.readFile(uri));

        return parseSageIni(
          text.split(/\r?\n/),
          await this.documents.getSchema(),
          {
            isFragment: isFragmentPath(uri.path),
          },
        );
      })();
      this.parses.set(key, parse);
    }
    return parse;
  }

  /** The top-level block a definition opens */
  private async blockAt(
    uri: vscode.Uri,
    line: number,
  ): Promise<{ parsed: SageDocument; block: SageBlock } | undefined> {
    let parsed: SageDocument;

    // The index can still list a file deleted a moment ago
    try {
      parsed = await this.parse(uri);
    } catch {
      this.parses.delete(uri.toString());
      return undefined;
    }
    let found: SageBlock | undefined;

    forEachBlock(parsed.blocks, (block) => {
      if (block.startLine === line) {
        found ??= block;
      }
    });
    return found && { parsed, block: found };
  }

  private async build(): Promise<SheetRow[]> {
    await this.index.whenReady();

    const objects = new Map<string, { stats: ObjectStats; uri: string }>();

    for (const keyword of OBJECT_KEYWORDS) {
      for (const name of this.index.getNames(keyword)) {
        const [place] = this.index.findDefinitions(keyword, name);
        const found = place && (await this.blockAt(place.uri, place.line));

        if (found && !objects.has(name.toLowerCase())) {
          objects.set(name.toLowerCase(), {
            stats: readObjectStats(found.parsed, found.block),
            uri: place.uri.toString(),
          });
        }
      }
    }

    const rows: SheetRow[] = [...objects.values()].map(({ stats, uri }) => {
      const cells: SheetRow['cells'] = {};
      let selectable = stats.selectable;

      for (const column of STAT_COLUMNS) {
        const own = stats.values[column];

        if (own) {
          cells[column] = cellOf(uri, own);
          continue;
        }

        // A child or reskin takes what it does not write from its parent
        let parent = stats.parent;

        for (let depth = 0; parent && depth < MAX_PARENTS; depth++) {
          const source = objects.get(parent.toLowerCase());
          const value = source?.stats.values[column];

          if (value && source) {
            cells[column] = cellOf(source.uri, value, source.stats.name);
            break;
          }
          parent = source?.stats.parent;
        }
      }
      for (
        let parent = stats.parent, depth = 0;
        parent && !selectable && depth < MAX_PARENTS;
        depth++
      ) {
        const source = objects.get(parent.toLowerCase());

        selectable = !!source?.stats.selectable;
        parent = source?.stats.parent;
      }

      return {
        name: stats.name,
        keyword: stats.keyword,
        parent: stats.parent,
        uri,
        line: stats.startLine,
        selectable,
        cells,
      };
    });

    // The primary weapon's numbers, from the weapon's own definition
    const users = new Map<string, number>();

    for (const row of rows) {
      const weapon = row.cells.weapon?.value.toLowerCase();

      if (weapon) {
        users.set(weapon, (users.get(weapon) ?? 0) + 1);
      }
    }
    for (const [weapon, count] of users) {
      const [place] = this.index.findDefinitions('Weapon', weapon);
      const found = place && (await this.blockAt(place.uri, place.line));

      if (!found) {
        continue;
      }

      const stats = readWeaponStats(found.parsed, found.block);

      for (const row of rows) {
        if (row.cells.weapon?.value.toLowerCase() !== weapon) {
          continue;
        }
        for (const column of WEAPON_COLUMNS) {
          const value = stats[column];

          if (value) {
            row.cells[column] = {
              ...cellOf(place.uri.toString(), value),
              shared: count,
            };
          }
        }
      }
    }
    return rows;
  }

  private async refresh(): Promise<void> {
    await this.panel.webview.postMessage({ kind: 'loading' });
    this.rows = await this.build();
    await this.panel.webview.postMessage({
      kind: 'rows',
      columns: STAT_COLUMNS,
      rows: this.rows,
    });
  }
}

const renderHtml = (): string => {
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { margin: 0; padding: 8px 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  #bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; position: sticky; top: 0; background: var(--vscode-editor-background); padding: 4px 0; z-index: 2; }
  input, select, button { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
  table { border-collapse: collapse; width: 100%; }
  th { position: sticky; top: 38px; background: var(--vscode-editor-background); text-align: left; cursor: pointer; white-space: nowrap; border-bottom: 1px solid var(--vscode-panel-border); padding: 3px 6px; z-index: 1; }
  td { padding: 2px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, transparent); white-space: nowrap; }
  td.number { text-align: right; font-variant-numeric: tabular-nums; }
  td.editable { cursor: text; }
  td.editable:hover { outline: 1px dashed var(--vscode-focusBorder); }
  td.inherited { opacity: 0.6; font-style: italic; }
  td.name { cursor: pointer; color: var(--vscode-textLink-foreground); }
  td input { width: 6em; }
  #notice { color: var(--vscode-errorForeground); }
  .muted { opacity: 0.7; }
</style></head><body>
<div id="bar">
  <input id="filter" placeholder="Filter by name, weapon or armor" size="30">
  <select id="side"><option value="">All sides</option></select>
  <label><input type="checkbox" id="selectable" checked> Units and buildings only</label>
  <label><input type="checkbox" id="buildable"> With a cost only</label>
  <button id="refresh">Refresh</button>
  <span id="count" class="muted"></span>
  <span id="notice"></span>
</div>
<table><thead><tr id="head"></tr></thead><tbody id="rows"></tbody></table>
<div id="more" class="muted"></div>
<script nonce="${nonce}">${BALANCE_SHEET_SCRIPT}</script>
</body></html>`;
};

export const registerBalanceSheet = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable =>
  vscode.commands.registerCommand('bigfs.openBalanceSheet', () =>
    BalanceSheet.show(documents, index),
  );
