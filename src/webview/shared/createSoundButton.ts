import type { PlaySoundRequest } from '../../core/soundClip';
import { element } from './element';
import { pageSoundPlayer } from './pageSoundPlayer';

/** Names the key that opens the file instead of playing it, as the platform calls it */
const getOpenKeyName = (): string =>
  /mac|iphone|ipad/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';

/**
 * Creates a play button for a sound name: it plays in the page at once, shows
 * a stop square while the sound plays, and opens the file with Ctrl or Cmd.
 * `post` sends the page's request to the extension.
 */
export const createSoundButton = (
  name: string,
  post: (request: PlaySoundRequest) => void,
  className?: string,
): HTMLButtonElement => {
  const button = element('button', '▶', className);
  const weak = new WeakRef(button);

  const show = () => {
    const live = weak.deref();

    if (!live) {
      unsubscribe();
      return;
    }

    const { phase, name: shown, error } = pageSoundPlayer.state();
    const active =
      shown === name && (phase === 'loading' || phase === 'playing');
    const failed = shown === name && phase === 'idle' && error;

    live.textContent = active ? '■' : '▶';
    live.title = failed
      ? error
      : `${active ? 'Stop' : 'Play'} ${name}. ${getOpenKeyName()}+click opens the file.`;
  };

  button.onclick = (event) => pageSoundPlayer.press(name, event, post);
  const unsubscribe = pageSoundPlayer.subscribe(show);

  show();
  return button;
};
