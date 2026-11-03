import {
  resolveAptText,
  stripTextStyle,
  getTextKey,
} from '../../formats/apt/aptText';

/**
 * The game's text in the language the editor chose, as it sent the movie:
 * each `$KEY` string the movies hold, by lowercased key. Without a table the
 * keys are shown as written.
 */

let texts: Record<string, string> | undefined;

/** Replaces the game text table with the one the editor sent with the movie */
export const setGameText = (resolved: Record<string, string> | undefined) => {
  texts = resolved;
};

/** Replaces a field's `$KEY` with the game's text for it; without a table the text is returned as written */
export const localise = (text: string): string => {
  if (!texts) {
    return text;
  }

  const key = getTextKey(text);

  return key
    ? (texts[key.toLowerCase()] ?? resolveAptText(text, () => undefined))
    : stripTextStyle(text);
};

/** Adds the text of movies sent later, keeping what is held for the rest */
export const mergeGameText = (more: Record<string, string> | undefined) => {
  if (more) {
    texts = { ...texts, ...more };
  }
};
