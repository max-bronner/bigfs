import { createSoundButton } from '../shared/createSoundButton';
import { element } from '../shared/element';
import { pageSoundPlayer } from '../shared/pageSoundPlayer';
import { getVsCodeApi } from '../shared/vscodeApi';
import type { FromSoundPage, ToSoundPage } from './protocol';

/**
 * The sound player's page, the place a sound plays that no page of its own
 * asked for, such as a lens in an INI file. It plays what the extension
 * sends and lists the last few to play again. A sound the browser refuses to
 * start, because nothing in this panel was clicked yet, waits for a press.
 */

const HISTORY = 12;

const vscode = getVsCodeApi<FromSoundPage>();
const status = document.getElementById('status')!;
const list = document.getElementById('history')!;
const history: string[] = [];

const post = (request: FromSoundPage) => vscode.postMessage(request);

const describeState = (): string => {
  const { phase, name, error } = pageSoundPlayer.state();

  switch (phase) {
    case 'loading':
      return `Loading ${name}`;
    case 'playing':
      return `Playing ${name}`;
    case 'blocked':
      return `Press ▶ next to ${name}: the browser starts sound only after a click in this panel`;
    default:
      return error ?? (name ? `Stopped ${name}` : 'Nothing played yet');
  }
};

const showHistory = () =>
  list.replaceChildren(
    ...history.map((name) => {
      const item = element('li');

      item.append(createSoundButton(name, post), ` ${name}`);
      return item;
    }),
  );

pageSoundPlayer.subscribe(() => {
  status.textContent = describeState();
});

window.addEventListener('message', ({ data }: MessageEvent<ToSoundPage>) => {
  if (data.kind !== 'sound') {
    return;
  }
  if (data.id === undefined) {
    data = { ...data, id: pageSoundPlayer.begin(data.name) };
    if (!history.includes(data.name)) {
      history.unshift(data.name);
      history.splice(HISTORY);
      showHistory();
    }
  }
  void pageSoundPlayer.receive(data);
});

status.textContent = describeState();
vscode.postMessage({ kind: 'ready' });
