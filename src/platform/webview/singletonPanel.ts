import * as vscode from 'vscode';

/** Where a new panel opens: a column, or a column that keeps the editor's focus */
export type PanelColumn =
  | vscode.ViewColumn
  | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean };

/** Options `createSingletonPanel` opens its panel with */
export interface SingletonPanelConfig<Incoming> {
  viewType: string;
  title: string;
  column: PanelColumn;
  options: vscode.WebviewPanelOptions & vscode.WebviewOptions;
  /**
   * Fills a newly created panel, usually by setting its html. What it returns
   * is disposed when the panel closes.
   */
  render: (panel: vscode.WebviewPanel) => vscode.Disposable[] | void;
  /** Called for every message the page posts */
  onMessage?: (message: Incoming) => unknown;
  /** Called once when the panel closes, after its disposables are disposed */
  onDispose?: () => void;
}

/** Column and focus an already open panel is brought forward with */
export interface RevealOptions {
  column?: vscode.ViewColumn;
  preserveFocus?: boolean;
}

/** Handle on the one webview panel of a kind, as `createSingletonPanel` returns it */
export interface SingletonPanel<Outgoing = unknown> {
  /** Opens the panel, or brings the open one forward without redrawing it */
  show: (reveal?: RevealOptions) => vscode.WebviewPanel;
  /** Posts to the page; resolves `false` when the panel is not open */
  post: (message: Outgoing) => Thenable<boolean>;
  /** Closes the panel if it is open */
  dispose: () => void;
  /** Whether the panel is open now */
  isOpen: () => boolean;
}

/**
 * Creates the one webview panel of a kind: `show` opens it the first time and
 * reveals it after, and closing it releases everything `render` registered.
 * Panels keyed by something (a file, a definition) make one of these each.
 */
export const createSingletonPanel = <Incoming = unknown, Outgoing = unknown>({
  viewType,
  title,
  column,
  options,
  render,
  onMessage,
  onDispose,
}: SingletonPanelConfig<Incoming>): SingletonPanel<Outgoing> => {
  let current: vscode.WebviewPanel | undefined;

  const show = (reveal: RevealOptions = {}): vscode.WebviewPanel => {
    if (current) {
      current.reveal(reveal.column, reveal.preserveFocus);
      return current;
    }

    const panel = vscode.window.createWebviewPanel(
      viewType,
      title,
      column,
      options,
    );
    const disposables = [...(render(panel) ?? [])];

    if (onMessage) {
      disposables.push(panel.webview.onDidReceiveMessage(onMessage));
    }
    panel.onDidDispose(() => {
      current = undefined;
      disposables.forEach((each) => each.dispose());
      onDispose?.();
    });
    current = panel;
    return panel;
  };

  return {
    show,
    post: (message) =>
      current?.webview.postMessage(message) ?? Promise.resolve(false),
    dispose: () => current?.dispose(),
    isOpen: () => current !== undefined,
  };
};
