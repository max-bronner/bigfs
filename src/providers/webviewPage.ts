import { createNonce } from './webviewNonce';

/**
 * A webview page with its Content-Security-Policy: nothing loads unless it
 * is listed here, and only the page's own nonce-tagged style and scripts run.
 */
export interface WebviewPage {
  style: string;
  body: string;
  /** The page's inline script */
  script: string;
  /** Sources allowed beyond the page itself, by directive */
  allow?: { img?: string; media?: string; script?: string };
  /** Script files loaded before the inline script, from `allow.script` */
  scriptFiles?: string[];
}

export const webviewPage = ({
  style,
  body,
  script,
  allow = {},
  scriptFiles = [],
}: WebviewPage): string => {
  const nonce = createNonce();
  const policy = [
    "default-src 'none'",
    allow.img && `img-src ${allow.img}`,
    allow.media && `media-src ${allow.media}`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'${allow.script ? ` ${allow.script}` : ''}`,
  ]
    .filter(Boolean)
    .join('; ');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy};">
<style nonce="${nonce}">${style}</style>
</head><body>
${body}
${scriptFiles.map((file) => `<script nonce="${nonce}" src="${file}"></script>`).join('\n')}
<script nonce="${nonce}">${script}</script>
</body></html>`;
};
