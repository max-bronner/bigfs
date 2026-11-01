/**
 * What a row of the archive explorer is, as the `viewItem` of the menus in
 * `package.json` sees it
 */
export type RowContextKind =
  | 'source'
  | 'diskFolder'
  | 'archive'
  | 'folder'
  | 'file'
  | 'gameFolder'
  | 'looseFile';

/** Ends the context value of a row in a read-only source, which package.json keeps the edit items off */
const READ_ONLY_SUFFIX = 'ReadOnly';

const CONTEXT_PREFIXES: Record<RowContextKind, string> = {
  source: 'bigSource',
  diskFolder: 'bigDiskFolder',
  archive: 'bigArchive',
  folder: 'bigFolder',
  file: 'bigFile',
  gameFolder: 'bigGameFolder',
  looseFile: 'bigLooseFile',
};

/**
 * Gets the context value a row is given: its kind, with `ReadOnly` appended
 * for a row in a source that is never written
 */
export const getContextValue = (
  kind: RowContextKind,
  isReadOnly = false,
): string => `${CONTEXT_PREFIXES[kind]}${isReadOnly ? READ_ONLY_SUFFIX : ''}`;
