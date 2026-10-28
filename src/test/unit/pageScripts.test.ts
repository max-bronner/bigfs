import * as assert from 'assert';
import { MAP_VIEW_SCRIPT } from '../../features/map/mapViewScript';
import { SCRIPT_FILE_VIEW_SCRIPT } from '../../features/scripts/scriptTreeScript';
import { WND_PREVIEW_SCRIPT } from '../../features/wnd/wndPreviewScript';
import { BALANCE_SHEET_SCRIPT } from '../../features/balanceSheet/balanceSheetScript';
import { STRING_TABLE_SCRIPT } from '../../features/strings/stringTableViewScript';

suite('Page scripts', () => {
  // They are template literals, where a stray escape breaks the page silently
  test('every webview script parses', () => {
    for (const script of [
      BALANCE_SHEET_SCRIPT,
      MAP_VIEW_SCRIPT,
      SCRIPT_FILE_VIEW_SCRIPT,
      STRING_TABLE_SCRIPT,
      WND_PREVIEW_SCRIPT,
    ]) {
      assert.doesNotThrow(() => new Function(script));
    }
  });
});
