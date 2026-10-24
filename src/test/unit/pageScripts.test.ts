import * as assert from 'assert';
import { APT_VIEW_SCRIPT } from '../../providers/aptViewScript';
import { MAP_VIEW_SCRIPT } from '../../providers/mapViewScript';
import { MODEL_SCRIPT } from '../../providers/previewModelScript';
import { STRING_TABLE_SCRIPT } from '../../providers/stringTableViewScript';

suite('Page scripts', () => {
  // They are template literals, where a stray escape breaks the page silently
  test('every webview script parses', () => {
    for (const script of [
      APT_VIEW_SCRIPT,
      MAP_VIEW_SCRIPT,
      MODEL_SCRIPT,
      STRING_TABLE_SCRIPT,
    ]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });
});
