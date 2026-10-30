import { Uri } from 'vscode';
import type { Webview } from 'vscode';

/** Gets the folder the extension's bundled webview pages are written to */
export const getPageBundleFolder = (extensionUri: Uri): Uri =>
  Uri.joinPath(extensionUri, 'dist', 'webview');

/**
 * Builds the `renderWebviewPage` options that load the bundled page `name` as a script
 * file the page's policy allows. The panel's `localResourceRoots` must hold
 * `getPageBundleFolder`.
 */
export const getPageBundleOptions = (
  extensionUri: Uri,
  webview: Webview,
  name: string,
): { allow: { script: string }; scriptFiles: string[] } => ({
  allow: { script: webview.cspSource },
  scriptFiles: [
    webview
      .asWebviewUri(Uri.joinPath(getPageBundleFolder(extensionUri), `${name}.js`))
      .toString(),
  ],
});
