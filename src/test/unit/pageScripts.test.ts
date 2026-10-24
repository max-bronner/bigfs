import * as assert from 'assert';
import { APT_VIEW_SCRIPT } from '../../providers/aptViewScript';
import { MODEL_SCRIPT } from '../../providers/previewModelScript';

suite('Page scripts', () => {
  // They are template literals, where a stray escape breaks the page silently
  test('every webview script parses', () => {
    for (const script of [APT_VIEW_SCRIPT, MODEL_SCRIPT]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });
});
