import * as vscode from 'vscode';
import { parseWnd, toBoxes } from './model/wndLayout';
import type { WndWindow } from './model/wndLayout';
import { WND_PREVIEW_SCRIPT } from './wndPreviewScript';
import { createNonce } from '../providers/webviewNonce';

/**
 * Language support for `.wnd` window layouts: problems, an outline of the
 * windows by name, folding, completion of the keys and flag values EA's
 * reader knows, and a live layout preview beside the text.
 */

export const WND_LANGUAGE = 'sage-wnd';

const selector: vscode.DocumentSelector = { language: WND_LANGUAGE };

/** Window types, from `GameWindowManagerScript.cpp`'s type table */
const WINDOW_TYPES = [
  'USER',
  'PUSHBUTTON',
  'RADIOBUTTON',
  'CHECKBOX',
  'VERTSLIDER',
  'HORZSLIDER',
  'SCROLLLISTBOX',
  'ENTRYFIELD',
  'STATICTEXT',
  'PROGRESSBAR',
  'COMBOBOX',
  'TABCONTROL',
];

/** `STATUS` flags, from the same file's status table */
const STATUS_FLAGS = [
  'ACTIVE',
  'TOGGLE',
  'DRAGABLE',
  'ENABLED',
  'HIDDEN',
  'ABOVE',
  'BELOW',
  'IMAGE',
  'TABSTOP',
  'NOINPUT',
  'NOFOCUS',
  'DESTROYED',
  'BORDER',
  'SMOOTH_TEXT',
  'ONE_LINE',
  'NO_FLUSH',
  'SEE_THRU',
  'RIGHT_CLICK',
  'WRAP_CENTERED',
  'CHECK_LIKE',
  'HOTKEY_TEXT',
  'USE_OVERLAY_STATES',
  'NOT_READY',
  'FLASHING',
  'ALWAYS_COLOR',
  'ON_MOUSE_DOWN',
];

/** `STYLE` flags: the window types again, and mouse tracking */
const STYLE_FLAGS = [
  ...WINDOW_TYPES.filter((type) => type !== 'USER'),
  'USER',
  'MOUSETRACK',
];

/** Window and layout keys EA's reader has fields for */
const KEYS = [
  'WINDOWTYPE',
  'SCREENRECT',
  'NAME',
  'STATUS',
  'STYLE',
  'SYSTEMCALLBACK',
  'INPUTCALLBACK',
  'TOOLTIPCALLBACK',
  'DRAWCALLBACK',
  'FONT',
  'HEADERTEMPLATE',
  'TOOLTIPTEXT',
  'TOOLTIPDELAY',
  'TEXT',
  'TEXTCOLOR',
  'ENABLEDDRAWDATA',
  'DISABLEDDRAWDATA',
  'HILITEDRAWDATA',
  'LISTBOXDATA',
  'COMBOBOXDATA',
  'RADIOBUTTONDATA',
  'SLIDERDATA',
  'TEXTENTRYDATA',
  'STATICTEXTDATA',
  'TABCONTROLDATA',
  'FILE_VERSION',
  'LAYOUTINIT',
  'LAYOUTUPDATE',
  'LAYOUTSHUTDOWN',
];

const BLOCK_KEYWORDS = [
  'WINDOW',
  'END',
  'CHILD',
  'ENDALLCHILDREN',
  'STARTLAYOUTBLOCK',
  'ENDLAYOUTBLOCK',
];

const symbolsOf = (
  document: vscode.TextDocument,
  windows: WndWindow[],
): vscode.DocumentSymbol[] =>
  windows.map((window) => {
    const name = window.fields.find(
      (field) => field.key.toUpperCase() === 'NAME',
    );
    const type = window.fields.find(
      (field) => field.key.toUpperCase() === 'WINDOWTYPE',
    );
    const range = new vscode.Range(
      document.positionAt(window.start),
      document.positionAt(window.end),
    );
    const symbol = new vscode.DocumentSymbol(
      name ? name.value.replace(/^"|"$/g, '') : '(unnamed)',
      type?.value ?? '',
      vscode.SymbolKind.Object,
      range,
      new vscode.Range(range.start, document.positionAt(window.start + 6)),
    );

    symbol.children = symbolsOf(document, window.children);

    return symbol;
  });

const foldsOf = (
  document: vscode.TextDocument,
  windows: WndWindow[],
): vscode.FoldingRange[] =>
  windows.flatMap((window) => {
    const start = document.positionAt(window.start).line;
    const end = document.positionAt(window.end).line;

    return [
      ...(end > start ? [new vscode.FoldingRange(start, end)] : []),
      ...foldsOf(document, window.children),
    ];
  });

/** The preview panel of one document, redrawn as it changes */
class WndPreview {
  private static readonly panels = new Map<string, WndPreview>();
  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly document: vscode.TextDocument) {
    this.panel = vscode.window.createWebviewPanel(
      'bigfs.wndPreview',
      `Layout: ${document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] },
    );
    this.panel.webview.html = renderPreviewHtml();
    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.kind === 'ready') {
        this.update();
      } else if (message?.kind === 'reveal') {
        const position = document.positionAt(Number(message.offset));
        const editor = await vscode.window.showTextDocument(
          document,
          vscode.ViewColumn.One,
        );

        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    });
    this.panel.onDidDispose(() =>
      WndPreview.panels.delete(document.uri.toString()),
    );
  }

  public static show(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = WndPreview.panels.get(key);

    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);

      return;
    }

    WndPreview.panels.set(key, new WndPreview(document));
  }

  public static refresh(document: vscode.TextDocument): void {
    WndPreview.panels.get(document.uri.toString())?.update();
  }

  private update(): void {
    void this.panel.webview.postMessage({
      kind: 'layout',
      boxes: toBoxes(parseWnd(this.document.getText()).windows),
    });
  }
}

/** The preview page: the windows drawn at their creation resolution */
export const renderPreviewHtml = (): string => {
  const nonce = createNonce();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { margin: 0; padding: 8px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  #bar { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
  canvas { background: #1b1c1f; max-width: 100%; cursor: pointer; }
  .muted { opacity: 0.7; }
</style></head><body>
<div id="bar"><label><input type="checkbox" id="hidden"> Show hidden</label><span id="status" class="muted"></span></div>
<canvas id="screen" width="800" height="600"></canvas>
<script nonce="${nonce}">${WND_PREVIEW_SCRIPT}</script>
</body></html>`;
};

export const registerSageWndLanguage = (
  context: vscode.ExtensionContext,
): void => {
  const diagnostics = vscode.languages.createDiagnosticCollection(WND_LANGUAGE);
  const refresh = (document: vscode.TextDocument) => {
    if (document.languageId !== WND_LANGUAGE) {
      return;
    }

    diagnostics.set(
      document.uri,
      parseWnd(document.getText()).problems.map((problem) => {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            document.positionAt(problem.start),
            document.positionAt(problem.end),
          ),
          problem.message,
          vscode.DiagnosticSeverity.Error,
        );

        diagnostic.source = 'bigFS';

        return diagnostic;
      }),
    );
    WndPreview.refresh(document);
  };

  vscode.workspace.textDocuments.forEach(refresh);

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) =>
      refresh(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) =>
      diagnostics.delete(document.uri),
    ),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: (document) =>
        symbolsOf(document, parseWnd(document.getText()).windows),
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges: (document) =>
        foldsOf(document, parseWnd(document.getText()).windows),
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: (document, position) => {
          const before = document
            .lineAt(position.line)
            .text.slice(0, position.character);
          const assignment =
            /^\s*([A-Za-z_]+)\s*=\s*(?:[^;]*\+\s*)?[A-Z_]*$/.exec(before);
          const values = (list: string[], kind: vscode.CompletionItemKind) =>
            list.map((value) => new vscode.CompletionItem(value, kind));

          if (assignment) {
            switch (assignment[1].toUpperCase()) {
              case 'WINDOWTYPE':
                return values(
                  WINDOW_TYPES,
                  vscode.CompletionItemKind.EnumMember,
                );
              case 'STATUS':
                return values(
                  STATUS_FLAGS,
                  vscode.CompletionItemKind.EnumMember,
                );
              case 'STYLE':
                return values(
                  STYLE_FLAGS,
                  vscode.CompletionItemKind.EnumMember,
                );
              default:
                return [];
            }
          }

          if (/^\s*[A-Za-z_]*$/.test(before)) {
            return [
              ...KEYS.map((key) => {
                const item = new vscode.CompletionItem(
                  key,
                  vscode.CompletionItemKind.Field,
                );

                item.insertText = new vscode.SnippetString(`${key} = $0;`);

                return item;
              }),
              ...values(BLOCK_KEYWORDS, vscode.CompletionItemKind.Keyword),
            ];
          }

          return [];
        },
      },
      '=',
      '+',
      ' ',
    ),
    vscode.commands.registerCommand(
      'bigfs.showWndPreview',
      (uri?: vscode.Uri) => {
        const document = uri
          ? vscode.workspace.textDocuments.find(
              (candidate) => candidate.uri.toString() === uri.toString(),
            )
          : vscode.window.activeTextEditor?.document;

        if (document) {
          WndPreview.show(document);
        } else if (uri) {
          void vscode.workspace
            .openTextDocument(uri)
            .then((opened) => WndPreview.show(opened));
        }
      },
    ),
  );
};
