import * as vscode from 'vscode';
import { decodeIniText } from '../core/windows1252';
import { isFragmentPath, parseSageIni } from '../formats/ini/sageIniParser';
import type { SageDocument } from '../formats/ini/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';

/**
 * A file's current text: its editor's when it is open there, so unsaved
 * edits count, else what is on disk.
 */

export const openDocument = (
  uri: vscode.Uri,
): vscode.TextDocument | undefined => {
  const key = uri.toString();

  return vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === key,
  );
};

export const readWorkspaceText = async (uri: vscode.Uri): Promise<string> =>
  openDocument(uri)?.getText() ??
  decodeIniText(await vscode.workspace.fs.readFile(uri));

export interface ParseCache {
  /** The parsed file, or nothing when it cannot be read (deleted since indexed) */
  get(uri: vscode.Uri): Promise<SageDocument | undefined>;
  delete(uri: vscode.Uri): void;
  clear(): void;
}

/** Parses each file once until told it changed; a failed read is retried next time */
export const createParseCache = (documents: SageIniDocuments): ParseCache => {
  const parses = new Map<string, Promise<SageDocument | undefined>>();

  return {
    get(uri) {
      const key = uri.toString();
      let parse = parses.get(key);

      if (!parse) {
        parse = (async () => {
          const open = openDocument(uri);

          if (open) {
            return documents.parse(open);
          }

          const text = decodeIniText(
            await vscode.workspace.fs.readFile(uri),
          );

          return parseSageIni(
            text.split(/\r?\n/),
            await documents.getSchema(),
            {
              isFragment: isFragmentPath(uri.path),
            },
          );
        })().catch(() => {
          parses.delete(key);
          return undefined;
        });
        parses.set(key, parse);
      }
      return parse;
    },
    delete(uri) {
      parses.delete(uri.toString());
    },
    clear() {
      parses.clear();
    },
  };
};
