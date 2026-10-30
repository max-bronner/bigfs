import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromModDiffPage } from './protocol';

/**
 * The mod report's page: the host writes the tables; the page filters them
 * by path and sends a button's action with the path of its row.
 */

const vscode = getVsCodeApi<FromModDiffPage>();

document.getElementById('filter')!.addEventListener('input', (event) => {
  const text = (event.target as HTMLInputElement).value.toLowerCase();

  document.querySelectorAll<HTMLElement>('tr[data-path]').forEach((row) => {
    row.hidden = !!text && !row.dataset.path!.toLowerCase().includes(text);
  });
});

document.body.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>(
    'button[data-action]',
  );

  if (button) {
    vscode.postMessage({
      action: button.dataset.action as FromModDiffPage['action'],
      path: button.closest<HTMLElement>('tr')!.dataset.path!,
    });
  }
});
