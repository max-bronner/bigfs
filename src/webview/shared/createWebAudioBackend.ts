import type { SoundBackend } from './createSoundPlayer';

/** How long a context may take to run before it counts as kept suspended */
const SUSPENDED_WAIT_MS = 300;

/**
 * The browser's Web Audio as the player's backend. One context serves the
 * page; `unlock` creates it and asks it to run inside a click, because a
 * context made outside one starts suspended. A webview's content security
 * policy needs no `media-src` for this: the bytes are decoded in memory.
 */
export const createWebAudioBackend = (): SoundBackend => {
  let context: AudioContext | undefined;

  const getContext = () => (context ??= new AudioContext());

  return {
    unlock: () => {
      void getContext().resume();
    },
    decode: (bytes) =>
      getContext().decodeAudioData(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    start: async (decoded, onEnded) => {
      const audio = getContext();

      // Outside a click the browser leaves resume() pending, so it is not awaited for long
      await Promise.race([
        audio.resume(),
        new Promise((resolve) => setTimeout(resolve, SUSPENDED_WAIT_MS)),
      ]);
      if (audio.state !== 'running') {
        return undefined;
      }

      const source = audio.createBufferSource();

      source.buffer = decoded as AudioBuffer;
      source.connect(audio.destination);
      source.onended = onEnded;
      source.start();
      return {
        stop: () => {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // Already ended
          }
        },
      };
    },
  };
};
