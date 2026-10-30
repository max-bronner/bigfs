import { Uri } from 'vscode';
import type { Webview } from 'vscode';

/** The folder the extension's bundled webview pages are written to. */
export const pageBundleFolder = (extensionUri: Uri): Uri =>
  Uri.joinPath(extensionUri, 'dist', 'webview');

/**
 * The `webviewPage` options that load the bundled page `name` as a script
 * file the page's policy allows. The panel's `localResourceRoots` must hold
 * `pageBundleFolder`.
 */
export const pageBundle = (
  extensionUri: Uri,
  webview: Webview,
  name: string,
): { allow: { script: string }; scriptFiles: string[] } => ({
  allow: { script: webview.cspSource },
  scriptFiles: [
    webview
      .asWebviewUri(Uri.joinPath(pageBundleFolder(extensionUri), `${name}.js`))
      .toString(),
  ],
});
