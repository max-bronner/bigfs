import * as vscode from "vscode";

/**
 * An open custom document whose whole parsed form is one immutable snapshot:
 * an edit replaces the snapshot, and its undo step puts the previous one back.
 */
export interface SnapshotDocument<T> extends vscode.CustomDocument {
  snapshot: T;
  /** Whether the file is read-only to the user, as one in a game install is */
  readonly isReadOnly: boolean;
  /** The functions that redraw each panel showing the document */
  readonly views: Set<() => unknown>;
}

/** Conversion between a file's bytes and its snapshot, used to open, save, revert and back up */
export interface SnapshotFormat<T> {
  read(bytes: Uint8Array): T;
  /** May throw to refuse writing a snapshot the format cannot store */
  write(snapshot: T): Uint8Array;
}

/** The part of a custom editor provider's edit event emitter a snapshot edit fires */
export interface SnapshotEditEvents<D extends vscode.CustomDocument> {
  fire(event: vscode.CustomDocumentEditEvent<D>): void;
}

/**
 * Reads the bytes a custom document opens with: the backup VS Code kept of
 * unsaved changes when there is one, else the file itself.
 */
export const readSnapshotSource = (
  uri: vscode.Uri,
  backupId: string | undefined,
): Thenable<Uint8Array> =>
  vscode.workspace.fs.readFile(backupId ? vscode.Uri.parse(backupId) : uri);

/** Whether the file system marks a file read-only; a file it cannot stat counts as writable. */
export const isReadOnlyFile = async (uri: vscode.Uri): Promise<boolean> => {
  const stat = await vscode.workspace.fs.stat(uri).then(
    (found) => found,
    () => undefined,
  );

  return ((stat?.permissions ?? 0) & vscode.FilePermission.Readonly) !== 0;
};

/** Creates the document a snapshot editor opens; disposing it forgets its views. */
export const createSnapshotDocument = <T>(
  uri: vscode.Uri,
  snapshot: T,
  isReadOnly: boolean,
): SnapshotDocument<T> => {
  const views = new Set<() => unknown>();

  return {
    uri,
    snapshot,
    isReadOnly,
    views,
    dispose: () => views.clear(),
  };
};

/** Redraws every panel showing a document. */
export const redrawSnapshotViews = <T>(document: SnapshotDocument<T>): void =>
  document.views.forEach((send) => void send());

/** Registers the function that redraws a panel until the panel closes. */
export const addSnapshotView = <T>(
  document: SnapshotDocument<T>,
  panel: vscode.WebviewPanel,
  send: () => unknown,
): void => {
  document.views.add(send);
  panel.onDidDispose(() => document.views.delete(send));
};

/**
 * Replaces a document's snapshot and fires the edit event whose undo and redo
 * swap the snapshots and redraw. It does not redraw for the edit itself.
 */
export const recordSnapshotEdit = <T, D extends SnapshotDocument<T>>(
  events: SnapshotEditEvents<D>,
  document: D,
  label: string,
  after: T,
): void => {
  const before = document.snapshot;

  document.snapshot = after;
  events.fire({
    document,
    label,
    undo: () => {
      document.snapshot = before;
      redrawSnapshotViews(document);
    },
    redo: () => {
      document.snapshot = after;
      redrawSnapshotViews(document);
    },
  });
};

/** Writes a document's snapshot to a file: its own on save, another on save as. */
export const saveSnapshot = async <T>(
  document: SnapshotDocument<T>,
  format: SnapshotFormat<T>,
  destination: vscode.Uri = document.uri,
): Promise<void> => {
  await vscode.workspace.fs.writeFile(
    destination,
    format.write(document.snapshot),
  );
};

/** Reads a document's file back into its snapshot and redraws. */
export const revertSnapshot = async <T>(
  document: SnapshotDocument<T>,
  format: SnapshotFormat<T>,
): Promise<void> => {
  document.snapshot = format.read(
    await vscode.workspace.fs.readFile(document.uri),
  );
  redrawSnapshotViews(document);
};

/** Writes a document's snapshot where VS Code keeps backups; the backup's id is the uri `readSnapshotSource` reopens. */
export const backupSnapshot = async <T>(
  document: SnapshotDocument<T>,
  format: SnapshotFormat<T>,
  context: vscode.CustomDocumentBackupContext,
): Promise<vscode.CustomDocumentBackup> => {
  await saveSnapshot(document, format, context.destination);

  return {
    id: context.destination.toString(),
    delete: () => vscode.workspace.fs.delete(context.destination),
  };
};
