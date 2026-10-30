import * as vscode from 'vscode';
import { decodeIniText, encodeWindows1252 } from '../../core/windows1252';
import type { ArchiveModel } from '../archives/archiveModel';
import { getFileNodes } from '../archives/virtualNode';
import { getNodeUri } from '../archives/nodeAddress';
import { SCHEME } from '../../constants';

/**
 * Text entries inside archives, for the tools that otherwise work on files
 * of the workspace: finding them, telling which may be written, and saving
 * several edited entries so each archive is rewritten once.
 */

/** A text entry found inside an archive, as `listArchiveEntries` lists it */
export interface ArchiveTextEntry {
  uri: vscode.Uri;
  archivePath: string;
  /** In a base game that is never written to */
  readOnly: boolean;
}

/** Whether a uri names something inside an archive rather than a file on disk */
export const isArchiveUri = (uri: vscode.Uri): boolean => uri.scheme === SCHEME;

/** Lists every entry of every archive whose path matches, reading each archive's index first */
export const listArchiveEntries = async (
  archiveModel: ArchiveModel,
  pattern: RegExp,
): Promise<ArchiveTextEntry[]> => {
  const entries: ArchiveTextEntry[] = [];

  for (const root of archiveModel.getArchiveRoots()) {
    try {
      await archiveModel.loadArchiveOf(root);
    } catch {
      continue; // one unreadable archive must not stop the rest
    }
    for (const node of getFileNodes(root)) {
      if (pattern.test(node.entryPath)) {
        entries.push({
          uri: getNodeUri(node),
          archivePath: root.archive.archivePath,
          readOnly: archiveModel.isReadOnly(root.archive),
        });
      }
    }
  }
  return entries;
};

/** Whether a file can be edited: one on disk, or an entry of an archive that may be written */
export const isEditable = (archiveModel: ArchiveModel, uri: vscode.Uri) =>
  !isArchiveUri(uri) || !archiveModel.isReadOnlyUri(uri);

/** Reads an entry, or any file, as INI text */
export const readEntryText = async (uri: vscode.Uri): Promise<string> =>
  decodeIniText(await vscode.workspace.fs.readFile(uri));

/** Bytes an entry held before a save, which `restoreEntries` puts back */
export interface SavedText {
  uri: vscode.Uri;
  before: Uint8Array;
}

/**
 * Saves new text for entries of writable archives, one save per archive,
 * and returns what each held before so the save can be undone
 */
export const saveEntryTexts = async (
  archiveModel: ArchiveModel,
  texts: readonly { uri: vscode.Uri; text: string }[],
): Promise<SavedText[]> => {
  const saved: SavedText[] = [];
  const files: { uri: vscode.Uri; content: Uint8Array }[] = [];

  for (const { uri, text } of texts) {
    let before: Uint8Array | undefined;

    try {
      before = await vscode.workspace.fs.readFile(uri);
    } catch {
      // A new entry: undoing it has nothing to put back
    }
    if (before) {
      saved.push({ uri, before });
    }
    files.push({ uri, content: encodeWindows1252(text, 0x3f) });
  }
  await archiveModel.writeFiles(files);
  return saved;
};

/** Puts back what a save replaced, again one save per archive */
export const restoreEntries = (
  archiveModel: ArchiveModel,
  saved: readonly SavedText[],
): Promise<void> =>
  archiveModel.writeFiles(
    saved.map(({ uri, before }) => ({ uri, content: before })),
  );

/** Offers the base game files a change could not be written to as an override in a folder */
export const offerOverride = async (
  archiveModel: ArchiveModel,
  uris: readonly vscode.Uri[],
  message: string,
): Promise<void> => {
  const nodes = uris.flatMap((uri) => archiveModel.getNode(uri) ?? []);

  if (!nodes.length) {
    void vscode.window.showWarningMessage(message);
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    message,
    'Override in Folder',
  );

  if (answer === 'Override in Folder') {
    await vscode.commands.executeCommand(
      'bigfs.overrideInFolder',
      nodes[0],
      nodes,
    );
  }
};
