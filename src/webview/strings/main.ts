import { showNotice } from '../shared/noticeBar';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromStringsPage, StringsToPage } from './protocol';
import { renderTable } from './tableView';
import type { TableState } from './tableView';

/**
 * The string table editor's page: a filterable table of labels and their
 * text, edited in place. The extension owns the data; the page sends each
 * change and is sent the table back.
 */

const vscode = getVsCodeApi<FromStringsPage>();
const state: TableState = {
  rows: [],
  hasSpeech: false,
  canReveal: false,
  filter: '',
  page: 0,
};
const filter = document.getElementById('filter') as HTMLInputElement;
const post = (message: FromStringsPage) => vscode.postMessage(message);
const show = () => renderTable(state, post, show);

filter.addEventListener('input', () => {
  state.filter = filter.value;
  state.page = 0;
  show();
});
document.getElementById('more')!.addEventListener('click', () => {
  state.page += 1;
  show();
});
document.getElementById('add')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const label = document.getElementById('newLabel') as HTMLInputElement;
  const text = document.getElementById('newText') as HTMLInputElement;

  if (!label.value.trim()) {
    return;
  }
  post({ kind: 'add', label: label.value.trim(), value: text.value });
  label.value = '';
  text.value = '';
});

window.addEventListener('message', ({ data }: MessageEvent<StringsToPage>) => {
  if (data.kind === 'table') {
    state.rows = data.rows;
    state.hasSpeech = data.hasSpeech;
    state.canReveal = data.canReveal;
    document.getElementById('summary')!.textContent = data.summary;
    show();
  } else if (data.kind === 'notice') {
    showNotice(data.message);
  }
});

post({ kind: 'ready' });
