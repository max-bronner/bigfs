import { showNotice } from '../shared/noticeBar';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { MapEdit } from '../../formats/map/mapEdit';
import type { FromMapPage } from './protocol';
import { state } from './state';

/** The page's line to the editor */
export const vscode = getVsCodeApi<FromMapPage>();

/** Sends an edit to the editor, or says why a read-only map cannot take it. */
export const sendEdit = (edit: MapEdit): void => {
  if (state.readOnly) {
    showNotice('This map is read-only: it is part of a game install');
    return;
  }
  vscode.postMessage({ kind: 'edit', edit });
};
