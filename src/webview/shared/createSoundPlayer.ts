import type { PlaySoundRequest, SoundReply } from '../../core/soundClip';

/**
 * The one sound player of a page: at most one sound plays, a new request
 * replaces it, and pressing the button of the sound that is playing stops
 * it. A page asks the extension for a name and plays the bytes of the reply;
 * the page's own click is what lets the browser start the sound.
 */

/** What the player is doing, for the buttons that show it */
export interface SoundState {
  phase: 'idle' | 'loading' | 'playing' | 'blocked';
  /** The name requested last, which the buttons of that name show as playing */
  name?: string;
  /** Why the last request played nothing */
  error?: string;
}

/** The browser's audio, apart so the player's rules can run without it */
export interface SoundBackend {
  /** Starts or resumes the audio context; called inside a click, which is what lets it run */
  unlock(): void;
  /** Turns the bytes of a clip into something that starts */
  decode(bytes: Uint8Array): Promise<unknown>;
  /**
   * Starts a decoded clip and calls `onEnded` when it ends or is stopped.
   * Resolves nothing when the browser keeps the context suspended.
   */
  start(
    decoded: unknown,
    onEnded: () => void,
  ): Promise<{ stop(): void } | undefined>;
}

/** How a click is told from a request that no click made */
export interface SoundClick {
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Handle on a page's player */
export interface SoundPlayer {
  state(): SoundState;
  /** Calls the listener at every change of state; returns the way to stop */
  subscribe(listener: (state: SoundState) => void): () => void;
  /** Unlocks audio inside a click that will later cause a sound, such as the box that lets a movie play its sounds */
  unlock(): void;
  /** Starts waiting for a sound the extension sends unasked, replacing what plays; the id to answer it with */
  begin(name: string): number;
  /** Asks the extension to play a name, replacing what plays */
  request(name: string, post: (request: PlaySoundRequest) => void): void;
  /**
   * The press of a play button: Ctrl or Cmd asks the extension to open the
   * file, a press on the sound that plays stops it, any other press plays
   */
  press(
    name: string,
    click: SoundClick,
    post: (request: PlaySoundRequest) => void,
  ): void;
  /** Plays the reply to the last request; an older reply is dropped */
  receive(reply: SoundReply): Promise<void>;
  stop(): void;
}

const decodeBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** Creates the player over a backend; the page's own is `createWebAudioBackend` */
export const createSoundPlayer = (backend: SoundBackend): SoundPlayer => {
  let state: SoundState = { phase: 'idle' };
  let pending = 0;
  let playing: { stop(): void } | undefined;
  const listeners = new Set<(state: SoundState) => void>();

  const setState = (next: SoundState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  const stop = () => {
    pending++;
    const handle = playing;

    playing = undefined;
    handle?.stop();
    if (state.phase !== 'idle') {
      setState({ phase: 'idle', name: state.name });
    }
  };

  const begin = (name: string) => {
    stop();
    setState({ phase: 'loading', name });
    return pending;
  };

  const request: SoundPlayer['request'] = (name, post) => {
    post({ kind: 'playSound', name, id: begin(name) });
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unlock: () => backend.unlock(),
    begin,
    request,
    stop,
    press: (name, click, post) => {
      if (click.ctrlKey || click.metaKey) {
        post({ kind: 'playSound', name, open: true });
      } else if (
        state.name === name &&
        (state.phase === 'loading' || state.phase === 'playing')
      ) {
        stop();
      } else {
        backend.unlock();
        request(name, post);
      }
    },
    receive: async (reply) => {
      if (reply.id !== pending || state.phase !== 'loading') {
        return;
      }
      if (!reply.clip) {
        setState({
          phase: 'idle',
          name: reply.name,
          error: reply.error ?? `${reply.name} names no sound`,
        });
        return;
      }

      const mine = pending;

      try {
        const decoded = await backend.decode(decodeBase64(reply.clip.data));

        if (mine !== pending) {
          return;
        }

        let handle: { stop(): void } | undefined;

        handle = await backend.start(decoded, () => {
          if (playing === handle && mine === pending) {
            playing = undefined;
            setState({ phase: 'idle', name: reply.name });
          }
        });

        if (mine !== pending) {
          handle?.stop();
          return;
        }
        if (!handle) {
          setState({ phase: 'blocked', name: reply.name });
          return;
        }
        playing = handle;
        setState({ phase: 'playing', name: reply.name });
      } catch (error) {
        if (mine === pending) {
          setState({
            phase: 'idle',
            name: reply.name,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
};
