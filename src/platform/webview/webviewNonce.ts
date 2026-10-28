/** A random token for a webview page's Content-Security-Policy, so only its own scripts run */
export const createNonce = (): string =>
  Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join('');
