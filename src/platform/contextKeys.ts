import { commands } from 'vscode';

/** The context keys `when` clauses in `package.json` read, by the name the code sets them under */
const KEYS = {
  scanned: 'bigfs.scanned',
  hasArchives: 'bigfs.hasArchives',
  gameView: 'bigfs.gameView',
  hasClipboard: 'bigfs.hasClipboard',
} as const;

/** A name in the table of context keys this extension sets */
export type ContextKey = keyof typeof KEYS;

/** Sets a context key that `when` clauses can read */
export const setContextKey = async (
  key: ContextKey,
  value: boolean,
): Promise<void> => {
  await commands.executeCommand('setContext', KEYS[key], value);
};
