import { createSoundPlayer } from './createSoundPlayer';
import { createWebAudioBackend } from './createWebAudioBackend';

/** The page's one sound player, so a press anywhere on the page stops what another started */
export const pageSoundPlayer = createSoundPlayer(createWebAudioBackend());
