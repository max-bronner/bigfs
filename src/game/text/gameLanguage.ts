/**
 * Which languages an install has, and which one the text shows in. A game's
 * languages are the `lang/<Language>.big` archives of its install (such as
 * `English.big`); the `*Audio.big` archives beside them carry speech, not
 * text. Each holds its own `data/lotr.str`.
 */

/** The setting value that picks the language from what is installed */
export const AUTO_LANGUAGE = 'auto';

/**
 * Gets the language a `lang/<Language>.big` archive holds, lowercased, or
 * undefined for any other archive (speech archives included)
 */
export const getArchiveLanguage = (archivePath: string): string | undefined => {
  const match = /(?:^|[\\/])lang[\\/]([^\\/]+)\.big$/i.exec(archivePath);
  const name = match?.[1].toLowerCase();

  return name && !name.endsWith('audio') ? name : undefined;
};

/** Lists the languages the archives hold, each once, in the order first met */
export const listInstalledLanguages = (
  archivePaths: Iterable<string>,
): string[] => {
  const found = new Set<string>();

  for (const path of archivePaths) {
    const language = getArchiveLanguage(path);

    if (language) {
      found.add(language);
    }
  }
  return [...found];
};

/** Outcome of `chooseLanguage`: a settled language, or whether the user must pick one */
export interface LanguageChoice {
  /** The language to read, when it is settled */
  language?: string;
  /** Whether the user has to be asked, because several are installed */
  ask: boolean;
}

/**
 * Settles the language. A name in the setting wins; "auto" takes the only
 * installed language, then an earlier answer still installed, and otherwise
 * has to ask.
 */
export const chooseLanguage = (
  setting: string,
  installed: readonly string[],
  remembered?: string,
): LanguageChoice => {
  const wanted = setting.trim().toLowerCase();

  if (wanted && wanted !== AUTO_LANGUAGE) {
    return { language: wanted, ask: false };
  }
  if (installed.length === 1) {
    return { language: installed[0], ask: false };
  }
  if (remembered && installed.includes(remembered)) {
    return { language: remembered, ask: false };
  }
  return { ask: installed.length > 1 };
};
