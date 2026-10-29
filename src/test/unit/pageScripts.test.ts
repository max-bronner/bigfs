import * as assert from 'assert';
import { MAP_VIEW_SCRIPT } from '../../features/map/mapViewScript';
import { SCRIPT_FILE_VIEW_SCRIPT } from '../../features/scripts/scriptTreeScript';
import { STRING_TABLE_SCRIPT } from '../../features/strings/stringTableViewScript';

suite('Page scripts', () => {
  // They are template literals, where a stray escape breaks the page silently
  test('every webview script parses', () => {
    for (const script of [
      MAP_VIEW_SCRIPT,
      SCRIPT_FILE_VIEW_SCRIPT,
      STRING_TABLE_SCRIPT,
    ]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });
});
