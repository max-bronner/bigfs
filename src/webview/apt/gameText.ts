import {
  resolveAptText,
  stripTextStyle,
  textKey,
} from '../../formats/apt/aptText';

/**
 * The game's text in the language the editor chose, as it sent the movie:
 * each `$KEY` string the movies hold, by lowercased key. Without a table the
 * keys are shown as written.
 */

let texts: Record<string, string> | undefined;

export const setGameText = (resolved: Record<string, string> | undefined) => {
  texts = resolved;
};

/** A field's text with a `$KEY` replaced by the game's text for it */
export const localise = (text: string): string => {
  if (!texts) {
    return text;
  }

  const key = textKey(text);

  return key
    ? (texts[key.toLowerCase()] ?? resolveAptText(text, () => undefined))
    : stripTextStyle(text);
};
