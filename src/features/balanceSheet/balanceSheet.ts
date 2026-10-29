import * as vscode from 'vscode';
import { webviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { BALANCE_SHEET_SCRIPT } from './balanceSheetScript';
import {
  STAT_COLUMNS,
  readObjectStats,
  readWeaponStats,
} from '../../game/objects/objectStats';
import type {
  ObjectStats,
  StatColumn,
  StatValue,
} from '../../game/objects/objectStats';
import { forEachBlock } from '../../formats/ini/sageIniParser';
import type { SageBlock, SageDocument } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import {
  createParseCache,
  readWorkspaceText,
} from '../../services/ini/workspaceText';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';

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
  /** How a computed value is worked out; it is not written anywhere */
  derived?: string;
  /** What is written at the place, when the value is evaluated from it */
  written?: string;
}

export interface SheetRow {
  name: string;
  keyword: string;
  parent?: string;
  uri: string;
  line: number;
  selectable: boolean;
  cells: Partial<Record<StatColumn | 'dps', SheetCell>>;
}

const cellOf = (uri: string, value: StatValue, from?: string): SheetCell => ({
  value: value.value,
  written: value.written,
  uri,
  line: value.line,
  start: value.start,
  end: value.end,
  from,
});

/** What the page sends: a row and a column by name, never a place in a file */
interface FromSheetPage {
  kind?: string;
  row?: string;
  column?: string;
  value?: string;
  old?: string;
}

const createBalanceSheet = (
  documents: SageIniDocuments,
  index: SageIniIndex,
) => {
  const parses = createParseCache(documents);
  let rows: SheetRow[] = [];
  let loaded: Promise<void> | undefined;

  const panel = createSingletonPanel<FromSheetPage>({
    viewType: 'bigfs.balanceSheet',
    title: 'Balance Sheet',
    column: vscode.ViewColumn.Active,
    options: {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
    render: ({ webview }) => {
      parses.clear();
      webview.html = renderHtml();
      return [
        vscode.workspace.onDidChangeTextDocument(({ document }) =>
          parses.delete(document.uri),
        ),
      ];
    },
    onMessage: (message): Promise<unknown> =>
      receive(message).catch((error: unknown) =>
        panel.post({
          kind: 'notice',
          message: describeError(error),
        }),
      ),
  });

  /** Resolves once the table has been built and sent at least once */
  const whenLoaded = (): Promise<void> => loaded ?? Promise.resolve();

  /**
   * The page names a row and a column only; where the value is written is
   * looked up here, so the page can never point an edit at another file.
   */
  const receive = async (message: FromSheetPage): Promise<void> => {
    switch (message?.kind) {
      case 'ready':
        loaded = refresh();
        await loaded;
        break;
      case 'refresh':
        parses.clear();
        await refresh();
        break;
      case 'open': {
        const row = rowNamed(message.row);

        if (!row) {
          return;
        }

        const editor = await vscode.window.showTextDocument(
          vscode.Uri.parse(row.uri),
          { viewColumn: vscode.ViewColumn.Beside },
        );
        const at = new vscode.Position(row.line, 0);

        editor.selection = new vscode.Selection(at, at);
        editor.revealRange(new vscode.Range(at, at));
        break;
      }
      case 'edit':
        await edit(message);
        break;
    }
  };

  const rowNamed = (name: unknown): SheetRow | undefined =>
    rows.find((row) => row.name === name);

  /** Writes one value where it is written, and saves a file that was clean */
  const edit = async (change: FromSheetPage): Promise<void> => {
    const value = String(change.value ?? '').trim();
    const cell = rowNamed(change.row)?.cells[change.column as StatColumn];

    if (!value || /\s/.test(value)) {
      throw new Error('A value is one word or number');
    }
    if (cell?.uri === undefined || cell.line === undefined) {
      throw new Error(`${change.row} has no ${change.column} written to edit`);
    }

    const uri = vscode.Uri.parse(cell.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const range = new vscode.Range(
      cell.line,
      cell.start ?? 0,
      cell.line,
      cell.end ?? 0,
    );

    if (document.getText(range) !== change.old) {
      parses.delete(uri);
      await refresh();
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
    parses.delete(uri);
    await refresh();
  };

  /** The top-level block a definition opens */
  const blockAt = async (
    uri: vscode.Uri,
    line: number,
    texts: Map<string, Promise<string[]>>,
  ): Promise<
    { parsed: SageDocument; block: SageBlock; lines: string[] } | undefined
  > => {
    // The index can still list a file deleted a moment ago
    const parsed = await parses.get(uri);

    if (!parsed) {
      return undefined;
    }
    let found: SageBlock | undefined;

    forEachBlock(parsed.blocks, (block) => {
      if (block.startLine === line) {
        found ??= block;
      }
    });
    if (!found) {
      return undefined;
    }

    const key = uri.toString();
    let text = texts.get(key);

    if (!text) {
      text = readWorkspaceText(uri).then((all) => all.split(/\r?\n/));
      texts.set(key, text);
    }
    return { parsed, block: found, lines: await text };
  };

  const build = async (): Promise<SheetRow[]> => {
    await index.whenReady();

    const objects = new Map<string, { stats: ObjectStats; uri: string }>();
    const texts = new Map<string, Promise<string[]>>();
    const lookupMacro = (name: string) => index.findMacro(name)?.value;

    for (const keyword of OBJECT_KEYWORDS) {
      for (const name of index.getNames(keyword)) {
        const [place] = index.findDefinitions(keyword, name);
        const found = place && (await blockAt(place.uri, place.line, texts));

        if (found && !objects.has(name.toLowerCase())) {
          objects.set(name.toLowerCase(), {
            stats: readObjectStats(found.parsed, found.block, {
              lines: found.lines,
              lookupMacro,
            }),
            uri: place.uri.toString(),
          });
        }
      }
    }

    const built: SheetRow[] = [...objects.values()].map(({ stats, uri }) => {
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

    for (const row of built) {
      const weapon = row.cells.weapon?.value.toLowerCase();

      if (weapon) {
        users.set(weapon, (users.get(weapon) ?? 0) + 1);
      }
    }
    for (const [weapon, count] of users) {
      const [place] = index.findDefinitions('Weapon', weapon);
      const found = place && (await blockAt(place.uri, place.line, texts));

      if (!found) {
        continue;
      }

      const stats = readWeaponStats(found.parsed, found.block, {
        lines: found.lines,
        lookupMacro,
      });

      for (const row of built) {
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
        if (!stats.damage && stats.damageTotal) {
          row.cells.damage = {
            value: stats.damageTotal.value,
            derived: `The sum of the weapon's ${stats.damageTotal.nuggets} damage nuggets; each is edited in the weapon`,
          };
        }
      }
    }
    // Damage a second, from the weapon's total damage and its delay in milliseconds
    for (const row of built) {
      const damage = Number(row.cells.damage?.value);
      const delay = Number(row.cells.delay?.value);

      if (damage > 0 && delay > 0) {
        row.cells.dps = {
          value: String(Math.round((damage * 10000) / delay) / 10),
          derived: 'Damage × 1000 / Delay: one shot every Delay milliseconds',
        };
      }
    }
    return built;
  };

  const refresh = async (): Promise<void> => {
    await panel.post({ kind: 'loading' });
    rows = await build();
    await panel.post({
      kind: 'rows',
      columns: [...STAT_COLUMNS, 'dps'],
      rows,
    });
  };

  return {
    show: panel.show,
    whenLoaded,
    receive,
    get rows() {
      return rows;
    },
  };
};

const renderHtml = (): string => {
  return webviewPage({
    style: `
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
  td.derived { color: var(--vscode-charts-blue, #3794ff); }
  td.name { cursor: pointer; color: var(--vscode-textLink-foreground); }
  td input { width: 6em; }
  #notice { color: var(--vscode-errorForeground); }
  .muted { opacity: 0.7; }
`,
    body: `<div id="bar">
  <input id="filter" placeholder="Filter by name, weapon or armor" size="30">
  <select id="side"><option value="">All sides</option></select>
  <label><input type="checkbox" id="selectable" checked> Units and buildings only</label>
  <label><input type="checkbox" id="buildable"> With a cost only</label>
  <button id="refresh">Refresh</button>
  <span id="count" class="muted"></span>
  <span id="notice"></span>
</div>
<table><thead><tr id="head"></tr></thead><tbody id="rows"></tbody></table>
<div id="more" class="muted"></div>`,
    script: BALANCE_SHEET_SCRIPT,
  });
};

export const registerBalanceSheet = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable => {
  const sheet = createBalanceSheet(documents, index);

  return registerCommand('bigfs.openBalanceSheet', () => {
    sheet.show();
    return sheet;
  });
};
