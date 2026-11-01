import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { registerCommand } from '../../platform/commands';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import { renderWebviewPage } from '../../platform/webview/webviewPage';
import {
  getPageBundleFolder,
  getPageBundleOptions,
} from '../../platform/webview/pageBundle';
import type {
  FromBuilderPage,
  ToBuilderPage,
} from '../../webview/cursors/protocol';
import { loadBuilderImages } from './loadBuilderImages';

/**
 * **Build Animated Cursor**: images added from disk become the frames of an
 * `.ani` whose order, hotspots and durations are set in a panel with a live
 * loop. Saving asks where, starting in the workspace, and never writes beside
 * a source, which may sit in a game install.
 */

const IMAGE_EXTENSIONS = ['cur', 'ani', 'ico', 'png', 'tga'];

const createAnimationBuilder = (context: vscode.ExtensionContext) => {
  const scripts = getPageBundleFolder(context.extensionUri);
  let ready = Promise.resolve();
  let markReady = () => {};

  const post = (message: ToBuilderPage) => panel.post(message);
  const addImages = async (uris: vscode.Uri[]) => {
    try {
      const images = (await Promise.all(uris.map(loadBuilderImages))).flat();

      await post({ kind: 'images', images });
    } catch (error) {
      await post({ kind: 'error', message: describeError(error) });
    }
  };
  const pickImages = async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { Images: IMAGE_EXTENSIONS },
    });

    if (uris?.length) {
      await addImages(uris);
    }
  };
  const saveAnimation = async (bytes: Uint8Array) => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const output = await vscode.window.showSaveDialog({
      defaultUri: folder && vscode.Uri.joinPath(folder, 'cursor.ani'),
      filters: { 'Animated cursor': ['ani'] },
    });

    if (output) {
      await vscode.workspace.fs.writeFile(output, bytes);
      void vscode.window.showInformationMessage(
        `Wrote ${output.path.slice(output.path.lastIndexOf('/') + 1)}`,
      );
    }
  };
  const panel = createSingletonPanel<FromBuilderPage, ToBuilderPage>({
    viewType: 'bigfs.animationBuilder',
    title: 'Build Animated Cursor',
    column: vscode.ViewColumn.Active,
    options: {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [scripts],
    },
    render: ({ webview }) => {
      ready = new Promise((resolve) => {
        markReady = resolve;
      });
      webview.html = renderWebviewPage({
        ...getPageBundleOptions(context.extensionUri, webview, 'cursors'),
        style: `
body { color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); margin: 0; padding: 8px 12px; }
button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 3px 8px; border-radius: 2px; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
input { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; font: inherit; }
.controls { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.stage { display: inline-block; line-height: 0; }
.stage.checker { background: repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 16px 16px; }
canvas.pixelated { image-rendering: pixelated; }
.status { opacity: 0.8; }
.error { color: var(--vscode-errorForeground); }
`,
        body: '<main id="main"></main>',
      });
    },
    onMessage: (message) => {
      if (message.kind === 'ready') {
        markReady();
      } else if (message.kind === 'addImages') {
        void pickImages();
      } else {
        void saveAnimation(new Uint8Array(message.bytes));
      }
    },
  });

  return {
    /** Opens the builder, adding `uris` as its first frames */
    async open(uris: vscode.Uri[]) {
      panel.show();
      await ready;

      if (uris.length) {
        await addImages(uris);
      }
    },
  };
};

/** Registers the command that opens the animated cursor builder */
export const registerAnimationBuilder = (
  context: vscode.ExtensionContext,
): vscode.Disposable => {
  const builder = createAnimationBuilder(context);

  return registerCommand(
    'bigfs.buildAnimatedCursor',
    (target?: vscode.Uri, selected?: vscode.Uri[]) =>
      builder.open(selected ?? (target instanceof vscode.Uri ? [target] : [])),
  );
};
