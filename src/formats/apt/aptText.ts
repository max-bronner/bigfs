/**
 * The text of an APT movie's fields. A string starting with `$` is a key
 * into the game's string table (`$SoloPlay` is `APT:SoloPlay`), possibly
 * ending in a `&dropShadow` style marker that is not part of it. Ported from
 * mint's `apt-viewer` `localise`, after the engine's `GameText::fetch`.
 */

const DROP_SHADOW = '&dropshadow';

/** Strips a trailing `&dropShadow`, which is style, not text */
export const stripTextStyle = (text: string): string =>
  text.toLowerCase().endsWith(DROP_SHADOW)
    ? text.slice(0, text.length - DROP_SHADOW.length)
    : text;

/** Gets the string table key a text names, if it is a `$` key */
export const getTextKey = (text: string): string | undefined => {
  const plain = stripTextStyle(text);

  return plain.startsWith('$') && plain.length > 1 ? plain : undefined;
};

/**
 * Looks a `$` key up as `APT:<key>` first, then as the key itself; any other
 * text comes back with its style marker removed. A key neither spelling
 * finds shows as the game shows it, `MISSING: 'APT:<key>'`.
 */
export const resolveAptText = (
  text: string,
  find: (label: string) => string | undefined,
): string => {
  const key = getTextKey(text);

  if (!key) {
    return stripTextStyle(text);
  }

  const name = key.slice(1);

  return find(`APT:${name}`) ?? find(name) ?? `MISSING: 'APT:${name}'`;
};

/** Collects every distinct `$` key among strings, as written minus its style marker */
export const collectTextKeys = (strings: Iterable<unknown>): string[] => {
  const keys = new Set<string>();

  for (const value of strings) {
    const key = typeof value === 'string' ? getTextKey(value) : undefined;

    if (key) {
      keys.add(key);
    }
  }
  return [...keys];
};
