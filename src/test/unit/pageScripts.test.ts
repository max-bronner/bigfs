import * as assert from 'assert';
import { MAP_VIEW_SCRIPT } from '../../providers/mapViewScript';
import { MODEL_SCRIPT } from '../../providers/previewModelScript';
import { WND_PREVIEW_SCRIPT } from '../../language/wndPreviewScript';
import { BALANCE_SHEET_SCRIPT } from '../../language/balanceSheetScript';
import { STRING_TABLE_SCRIPT } from '../../providers/stringTableViewScript';

suite('Page scripts', () => {
  // They are template literals, where a stray escape breaks the page silently
  test('every webview script parses', () => {
    for (const script of [
      BALANCE_SHEET_SCRIPT,
      MAP_VIEW_SCRIPT,
      MODEL_SCRIPT,
      STRING_TABLE_SCRIPT,
      WND_PREVIEW_SCRIPT,
    ]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });
});
