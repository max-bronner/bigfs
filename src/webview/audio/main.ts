import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromSoundPage, ToSoundPage } from './protocol';

/**
 * The sound player's page: plays what the extension sends, one file for one
 * click, and lists the last few to play again.
 */

const HISTORY = 12;

interface Played {
  name: string;
  url: string;
}

const vscode = getVsCodeApi<FromSoundPage>();
const audio = document.getElementById('audio') as HTMLAudioElement;
const name = document.getElementById('name')!;
const list = document.getElementById('history')!;
const history: Played[] = [];

const play = (entry: Played) => {
  name.textContent = entry.name;
  audio.src = entry.url;
  audio.play().catch(() => {});
};

window.addEventListener('message', ({ data }: MessageEvent<ToSoundPage>) => {
  if (data.kind !== 'play') {
    return;
  }

  const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
  const entry = {
    name: data.name,
    url: URL.createObjectURL(new Blob([bytes], { type: data.mime })),
  };

  history.unshift(entry);
  history.splice(HISTORY);
  list.replaceChildren(
    ...history.map((each) => {
      const item = document.createElement('li');

      item.textContent = each.name;
      item.onclick = () => play(each);

      return item;
    }),
  );
  play(entry);
});

vscode.postMessage({ kind: 'ready' });
