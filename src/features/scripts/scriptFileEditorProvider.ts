import * as vscode from 'vscode';
import { MapFile, parseMap } from '../../formats/map/mapFile';
import { markSounds } from '../../formats/map/mapScriptSounds';
import { SCRIPT_FILE_VIEW_SCRIPT } from './scriptTreeScript';
import { webviewPage } from '../../platform/webview/webviewPage';

/**
 * Viewer for standalone `.scb` script files: the same player, group and
 * script tree the map editor shows, read-only. A `.scb` is the map
 * container holding a `PlayerScriptsList`, so the map reader decodes it;
 * writing one back is not supported.
 */

export const SCRIPT_FILE_VIEW_TYPE = 'bigfs.scriptViewer';

class ScriptDocument implements vscode.CustomDocument {
  public constructor(
    public readonly uri: vscode.Uri,
    public readonly map: MapFile,
  ) {}

  public dispose(): void {}
}

export const renderScriptFileHtml = (): string =>
  webviewPage({
    style: `
  body { margin: 0; padding: 0 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  h2 { font-size: 1.2em; margin: 10px 0 6px; }
  details { margin: 6px 0; } summary { cursor: pointer; }
  .muted { opacity: 0.65; }
  .problems { color: var(--vscode-editorWarning-foreground); }
  .script { margin-left: 12px; } .script .calls { margin: 0 0 4px 22px; opacity: 0.8; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
  button.play { padding: 0 4px; margin: 0 2px; font-size: 0.85em; cursor: pointer; }
  .script label { display: flex; gap: 4px; align-items: center; }
`,
    body: '<div id="root"></div>',
    script: SCRIPT_FILE_VIEW_SCRIPT,
  });

export class ScriptFileEditorProvider implements vscode.CustomReadonlyEditorProvider<ScriptDocument> {
  public static register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      SCRIPT_FILE_VIEW_TYPE,
      new ScriptFileEditorProvider(),
      { supportsMultipleEditorsPerDocument: true },
    );
  }

  public async openCustomDocument(uri: vscode.Uri): Promise<ScriptDocument> {
    return new ScriptDocument(
      uri,
      parseMap(await vscode.workspace.fs.readFile(uri)),
    );
  }

  public resolveCustomEditor(
    document: ScriptDocument,
    panel: vscode.WebviewPanel,
  ): void {
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    panel.webview.html = renderScriptFileHtml();
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.kind === 'ready') {
        void panel.webview.postMessage({
          kind: 'scripts',
          name: document.uri.path.split('/').pop(),
          scripts: document.map.scripts.map(markSounds),
          problems: document.map.problems,
        });
      } else if (
        message?.kind === 'playSound' &&
        typeof message.name === 'string' &&
        message.name
      ) {
        void vscode.commands.executeCommand(
          'bigfs.playAudioEvent',
          message.name,
          document.uri.toString(),
        );
      }
    });
  }
}
