import * as assert from 'assert';
import { renderWebviewPage } from '../../platform/webview/webviewPage';

const policyOf = (html: string): string =>
  /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';

suite('webviewPage', () => {
  test('lets only the nonce-tagged style in by default', () => {
    const policy = policyOf(renderWebviewPage({ style: '', body: '' }));

    assert.match(policy, /style-src 'nonce-[a-z0-9]{32}';/);
  });

  test('uses the given style sources in place of the nonce', () => {
    const policy = policyOf(
      renderWebviewPage({
        style: '',
        body: '',
        allow: { img: 'blob: data:', script: 'https://page' },
        styleSources: "https://page 'unsafe-inline'",
        scriptFiles: ['https://page/apt.js'],
      }),
    );

    assert.match(policy, /style-src https:\/\/page 'unsafe-inline';/);
    assert.doesNotMatch(policy, /style-src[^;]*nonce/);
    assert.match(policy, /script-src 'nonce-[a-z0-9]{32}' https:\/\/page;/);
    assert.match(policy, /img-src blob: data:;/);
  });
});
