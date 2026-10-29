import * as vscode from 'vscode';
import { openDocument } from '../../services/ini/workspaceText';
import { parseWnd, toBoxes } from '../../formats/wnd/wndLayout';
import type { WndBox, WndWindow } from '../../formats/wnd/wndLayout';
import {
  imageExtent,
  isRotated,
  mappedUv,
} from '../../formats/mappedImage/mappedImage';
import type { UvRect } from '../../formats/mappedImage/mappedImage';
import type { EntryLocator } from '../../services/entryLocator';
import { encodePng } from '../../node/png';
import {
  loadMappedTexture,
  readMappedImage,
} from '../preview/mappedImagePreview';
import type { GameLanguage } from '../../services/ini/gameLanguage';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { WND_PREVIEW_SCRIPT } from './wndPreviewScript';
import { webviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';

/**
 * Language support for `.wnd` window layouts: problems, an outline of the
 * windows by name, folding, completion of the keys and flag values EA's
 * reader knows, and a live layout preview beside the text. The preview draws
 * the images the INI's `MappedImage` definitions name, and the text through
 * the string tables, when the index and locator are supplied.
 */

/** What the preview reads the game's data through */
export interface WndPreviewServices {
  index: SageIniIndex;
  /** Settles the language labels resolve in before the text is drawn */
  gameLanguage?: GameLanguage;
  locator: EntryLocator;
}

/** One image of a layout: where its texture is, and how it maps */
interface PreviewImage {
  texture: string;
  uv: UvRect;
  rotated: boolean;
  /** Pixels it draws at, `Coords`' size swapped when rotated */
  extent: [number, number];
}

interface ResolvedImage {
  image: PreviewImage;
  /** The texture's PNG, until it has been sent */
  dataUri: string;
}

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
  'COMMANDBUTTON',
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

/** The draw data of a gadget's own parts, which mint's gadgets read */
const GADGET_DRAW_KEYS = [
  'LISTBOXENABLEDUPBUTTONDRAWDATA',
  'LISTBOXHILITEUPBUTTONDRAWDATA',
  'LISTBOXENABLEDDOWNBUTTONDRAWDATA',
  'LISTBOXHILITEDOWNBUTTONDRAWDATA',
  'LISTBOXENABLEDSLIDERDRAWDATA',
  'LISTBOXHILITESLIDERDRAWDATA',
  'SLIDERTHUMBENABLEDDRAWDATA',
  'SLIDERTHUMBHILITEDRAWDATA',
  'COMBOBOXDROPDOWNBUTTONENABLEDDRAWDATA',
  'COMBOBOXDROPDOWNBUTTONHILITEDRAWDATA',
  'COMBOBOXDROPDOWNBUTTONDISABLEDDRAWDATA',
  'COMBOBOXEDITBOXENABLEDDRAWDATA',
  'COMBOBOXEDITBOXHILITEDRAWDATA',
  'COMBOBOXLISTBOXENABLEDDRAWDATA',
  'COMBOBOXLISTBOXHILITEDRAWDATA',
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
  ...GADGET_DRAW_KEYS,
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

/** Creates the preview panel of one document, redrawn as it changes */
const createWndPreview = (
  document: vscode.TextDocument,
  services: WndPreviewServices | undefined,
  onClose: () => void,
) => {
  /** Images already resolved, by lowercased name; `null` for a name nothing defines */
  const images = new Map<string, Promise<ResolvedImage | null>>();
  /** Textures the page already has */
  const sent = new Set<string>();
  let version = 0;

  const panel = createSingletonPanel({
    viewType: 'bigfs.wndPreview',
    title: `Layout: ${document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1)}`,
    column: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    options: { enableScripts: true, localResourceRoots: [] },
    render: ({ webview }) => {
      webview.html = renderPreviewHtml();
    },
    onMessage: async (message: { kind?: string; offset?: unknown }) => {
      if (message?.kind === 'ready') {
        void update();
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
    },
    onDispose: onClose,
  });

  /**
   * The image a `MappedImage` of this name draws: its texture as a PNG data
   * URI, and the rect of it the definition's `Coords` cover
   */
  const resolveImage = (name: string): Promise<ResolvedImage | null> => {
    const key = name.toLowerCase();
    let cached = images.get(key);

    if (!cached) {
      cached = loadImage(name).catch(() => null);
      images.set(key, cached);
    }

    return cached;
  };

  const loadImage = async (name: string): Promise<ResolvedImage | null> => {
    const { index, locator } = services ?? {};
    const definition = index?.findDefinitions('MappedImage', name)[0];

    if (!locator || !definition) {
      return null;
    }

    const mapped = await readMappedImage(definition);
    const texture =
      mapped.texture &&
      (await loadMappedTexture(locator, mapped.texture, definition.uri));

    if (!mapped.texture || !texture) {
      return null;
    }

    return {
      image: {
        texture: mapped.texture.toLowerCase(),
        uv: mappedUv(mapped, [texture.width, texture.height]),
        rotated: isRotated(mapped),
        extent: imageExtent(mapped) ?? [texture.width, texture.height],
      },
      dataUri: `data:image/png;base64,${Buffer.from(encodePng(texture)).toString('base64')}`,
    };
  };

  const update = async (): Promise<void> => {
    const current = ++version;
    const { index, gameLanguage } = services ?? {};

    await gameLanguage?.ensure();

    const boxes = toBoxes(parseWnd(document.getText()).windows, {
      text: (value) => index?.findString(value)?.text,
    });
    const names = new Set<string>();
    const collect = (list: WndBox[]) =>
      list.forEach((box) => {
        Object.values(box.looks).forEach((parts) =>
          parts.forEach((part) => part.image && names.add(part.image)),
        );
        collect(box.children);
      });

    collect(boxes);

    const found: Record<string, PreviewImage> = {};
    const textures: Record<string, string> = {};

    for (const name of names) {
      const resolved = await resolveImage(name);

      if (resolved) {
        found[name] = resolved.image;

        if (!sent.has(resolved.image.texture)) {
          textures[resolved.image.texture] = resolved.dataUri;
        }
      }
    }

    // A newer edit is already on its way; its message carries the textures
    if (current !== version) {
      return;
    }

    Object.keys(textures).forEach((id) => sent.add(id));
    void panel.post({
      kind: 'layout',
      boxes,
      images: found,
      textures,
    });
  };

  return {
    show: () =>
      panel.show({ column: vscode.ViewColumn.Beside, preserveFocus: true }),
    update,
  };
};

const openWndPreviews = new Map<string, ReturnType<typeof createWndPreview>>();

/** Opens the layout preview of a document, or brings the open one forward */
const showWndPreview = (
  document: vscode.TextDocument,
  services?: WndPreviewServices,
): void => {
  const key = document.uri.toString();
  const preview =
    openWndPreviews.get(key) ??
    createWndPreview(document, services, () => openWndPreviews.delete(key));

  openWndPreviews.set(key, preview);
  preview.show();
};

/** Draws the document again in its preview, if one is open */
const refreshWndPreview = (document: vscode.TextDocument): void => {
  void openWndPreviews.get(document.uri.toString())?.update();
};

/** The preview page: the windows drawn at their creation resolution */
export const renderPreviewHtml = (): string => {
  return webviewPage({
    style: `
  body { margin: 0; padding: 8px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  #bar { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; }
  canvas { background: #1b1c1f; max-width: 100%; cursor: pointer; }
  .muted { opacity: 0.7; }
`,
    allow: { img: 'data:' },
    body: `<div id="bar"><label>State <select id="state"><option value="enabled">Enabled</option><option value="hilite">Hilite</option><option value="disabled">Disabled</option></select></label><label><input type="checkbox" id="checked"> Checked</label><label><input type="checkbox" id="outlines" checked> Outlines</label><label><input type="checkbox" id="hidden"> Show hidden</label><span id="status" class="muted"></span></div>
<canvas id="screen" width="800" height="600"></canvas>`,
    script: WND_PREVIEW_SCRIPT,
  });
};

export const registerSageWndLanguage = (
  context: vscode.ExtensionContext,
  services?: WndPreviewServices,
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
    refreshWndPreview(document);
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
          ? openDocument(uri)
          : vscode.window.activeTextEditor?.document;

        if (document) {
          showWndPreview(document, services);
        } else if (uri) {
          void vscode.workspace
            .openTextDocument(uri)
            .then((opened) => showWndPreview(opened, services));
        }
      },
    ),
  );
};
