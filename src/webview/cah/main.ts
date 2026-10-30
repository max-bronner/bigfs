import { showNotice } from '../shared/noticeBar';
import { getVsCodeApi } from '../shared/vscodeApi';
import { renderHero } from './heroForm';
import type { CahToPage, FromCahPage } from './protocol';

/**
 * The hero file editor's page: the hero as a form. The extension owns the
 * data; the page sends each change and is sent the hero back.
 */

const vscode = getVsCodeApi<FromCahPage>();
const post = (message: FromCahPage) => vscode.postMessage(message);

document.getElementById('addBling')!.addEventListener('click', () => {
  post({ kind: 'addBling', value: 'NewGroup' });
});

window.addEventListener('message', ({ data }: MessageEvent<CahToPage>) => {
  if (data.kind === 'hero') {
    renderHero(data, post);
  } else if (data.kind === 'notice') {
    showNotice(data.message);
  }
});

post({ kind: 'ready' });
