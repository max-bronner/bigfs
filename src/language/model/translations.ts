/**
 * Which game text a mod has in one language and not another. A mod that
 * adds a unit to its English table but not its German one shows a missing
 * label to German players. Tables are grouped by the language their path
 * names (`lang/german/…`, `german.str`), and failing that the language a
 * `.csf` header records.
 */

/** Language folder and file names as installs and mods spell them */
const LANGUAGES = [
  'english',
  'german',
  'french',
  'spanish',
  'italian',
  'polish',
  'russian',
  'dutch',
  'swedish',
  'norwegian',
  'danish',
  'finnish',
  'czech',
  'hungarian',
  'portuguese',
  'brazilian',
  'chinese',
  'korean',
  'japanese',
  'arabic',
  'greek',
  'turkish',
];

/**
 * The header's language word, as the C&C string format numbers them
 * (community documentation of `.csf`, a weaker source than a path)
 */
const CSF_LANGUAGES = [
  'english',
  'english (uk)',
  'german',
  'french',
  'spanish',
  'italian',
  'japanese',
  'jabber',
  'korean',
  'chinese',
];

/** The language a table is in, from its path, else its header, else unknown */
export const languageOf = (path: string, csfLanguage?: number): string => {
  const segments = path
    .toLowerCase()
    .split(/[\\/]/)
    .flatMap((segment) => [segment, segment.replace(/\.[^.]*$/, '')]);
  const named = LANGUAGES.find((language) =>
    segments.some(
      (segment) =>
        segment === language ||
        segment.startsWith(`${language}_`) ||
        segment.endsWith(`_${language}`),
    ),
  );

  if (named) {
    return named;
  }
  if (csfLanguage !== undefined) {
    return CSF_LANGUAGES[csfLanguage] ?? `language ${csfLanguage}`;
  }
  return 'unknown';
};

export interface StringTable {
  path: string;
  language: string;
  /** By lowercased label: the label as written and its text */
  labels: ReadonlyMap<string, { label: string; text: string }>;
}

export interface LanguageGap {
  language: string;
  tables: string[];
  /** Labels another language has and this one lacks, with that language's text */
  missing: { label: string; text: string; from: string }[];
}

/** Every language's missing labels, against the union of all of them */
export const translationGaps = (tables: StringTable[]): LanguageGap[] => {
  const languages = new Map<string, StringTable[]>();

  for (const table of tables) {
    languages.set(table.language, [
      ...(languages.get(table.language) ?? []),
      table,
    ]);
  }

  const has = (language: string, key: string) =>
    languages.get(language)!.some((table) => table.labels.has(key));
  const union = new Map<
    string,
    { label: string; text: string; from: string }
  >();

  // English first, so a stand-in text is English where it can be
  for (const [language, own] of [...languages].sort(([a], [b]) =>
    a === 'english' ? -1 : b === 'english' ? 1 : a.localeCompare(b),
  )) {
    for (const table of own) {
      for (const [key, { label, text }] of table.labels) {
        if (!union.has(key)) {
          union.set(key, { label, text, from: language });
        }
      }
    }
  }

  return [...languages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, own]) => ({
      language,
      tables: own.map((table) => table.path),
      missing: [...union]
        .filter(([key]) => !has(language, key))
        .map(([, entry]) => entry)
        .sort((a, b) => a.label.localeCompare(b.label)),
    }));
};
