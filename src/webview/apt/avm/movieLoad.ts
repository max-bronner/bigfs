/**
 * What a movie's own calls say about loading another movie and playing a
 * sound, read without any engine: `getURL`/`loadMovie` targets and URLs,
 * and the `PlaySound` command the retail menus send out. Ported from mint's
 * apt-player (`load.rs`, `expose.rs`).
 */

/** Gets the library name a URL names: its file stem, lowercased */
export const movieNameOf = (url: string): string | undefined => {
  const file = url.trim().split(/[\\/]/).pop() ?? '';
  const dot = file.lastIndexOf('.');
  const stem = dot < 0 ? file : file.slice(0, dot);

  return stem ? stem.toLowerCase() : undefined;
};

/** `getURL` targets that name a browser window, never a clip */
const WINDOWS = new Set(['_blank', '_self', '_top', '_parent']);

/** Whether a `getURL` target names a window or nothing, so loads leave it */
export const isWindowTarget = (target: string): boolean => {
  const lower = target.trim().toLowerCase();

  return !lower || WINDOWS.has(lower);
};

/** Parses the level a target names (`_level2`), if it names one */
export const levelOf = (target: string): number | undefined => {
  const match = /^_level(\d+)$/i.exec(target.trim());

  return match ? Number(match[1]) : undefined;
};

/** The last name of a command, after any `Movie::` scopes */
const lastName = (command: string): string => {
  const scope = command.lastIndexOf('::');

  return scope < 0 ? command : command.slice(scope + 2);
};

const PLAY_SOUND = 'playsound';

/**
 * Gets the sound event a call to the engine asks to play: `FSCommand:PlaySound`
 * or one scoped by a movie (`FSCommand:Movie::PlaySound`) with the event as
 * its argument, and `GameCode`/`GameCodeNoPrefix` whose first argument is
 * such a command, the rest the event. Nothing for any other call.
 */
export const soundEventOf = (
  call: string,
  args: readonly string[],
): string | undefined => {
  let event: string;

  if (/^fscommand:/i.test(call)) {
    if (
      lastName(call.slice('fscommand:'.length)).toLowerCase() !== PLAY_SOUND
    ) {
      return undefined;
    }
    event = args[0] ?? '';
  } else if (/^gamecode(noprefix)?$/i.test(call)) {
    if (lastName(args[0] ?? '').toLowerCase() !== PLAY_SOUND) {
      return undefined;
    }
    event = args.slice(1).join(',');
  } else {
    return undefined;
  }
  return event.trim() || undefined;
};
