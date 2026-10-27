import * as vscode from 'vscode';
import type { ArchiveModel } from '../model/archiveModel';
import { SCHEME } from '../constants';
import type { VirtualNode } from '../model/virtualNode';

/**
 * File system provider behind the `bigfs` scheme, through which an entry
 * reaches the editor. It reports failures as thrown `FileSystemError`s, which
 * the API requires, and hears about changes from the archive model
 */
export class BigFileSystemProvider implements vscode.FileSystemProvider {
  private onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  /** Events of the current burst, held until `fireSoon` delivers them as one */
  private bufferedEvents: vscode.FileChangeEvent[] = [];
  private fireSoonHandle?: NodeJS.Timeout;

  constructor(private archiveModel: ArchiveModel) {
    archiveModel.onDidChangeArchive(({ rootPath }) => {
      this.fireChangedDocuments(rootPath);
    });
  }

  /**
   * Announces the open documents of one archive as changed, so their editors
   * reload after it was rewritten. A dirty document is left out rather than
   * having the edits the user has not saved replaced under them
   */
  private fireChangedDocuments(rootPath: string): void {
    const archivePrefix = `${rootPath.toLowerCase()}/`;

    const changes = vscode.workspace.textDocuments
      .filter(
        (document) =>
          document.uri.scheme === SCHEME &&
          !document.isDirty &&
          document.uri.path.toLowerCase().startsWith(archivePrefix),
      )
      .map((document) => ({
        type: vscode.FileChangeType.Changed,
        uri: document.uri,
      }));

    if (changes.length) {
      this.fireSoon(...changes);
    }
  }

  /** Collects the events of a burst and delivers them as one notification */
  private fireSoon(...events: vscode.FileChangeEvent[]): void {
    this.bufferedEvents.push(...events);

    if (this.fireSoonHandle) {
      clearTimeout(this.fireSoonHandle);
    }

    this.fireSoonHandle = setTimeout(() => {
      this.onDidChangeFileEmitter.fire(this.bufferedEvents);
      this.bufferedEvents = [];
    }, 5);
  }

  watch(_uri: vscode.Uri): vscode.Disposable {
    // Required by the API; changes arrive through the archive model instead
    return new vscode.Disposable(() => {});
  }

  /**
   * Finds the node a uri names, reading the archive it points into first. A
   * uri can arrive here for an archive nobody has opened, which is why the
   * provider goes through this rather than `ArchiveModel.getNode`
   */
  private resolveNode(uri: vscode.Uri): Promise<VirtualNode | undefined> {
    return this.archiveModel.resolveNode(uri);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const node = await this.resolveNode(uri);
    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const size =
      node.type === vscode.FileType.File
        ? this.archiveModel.getFileSize(node)
        : 0;

    // The index table records no times. An entry reports when this session
    // wrote it, or when its archive was read, which is what tells an open
    // editor that the archive changed under it
    const mtime = node.archive?.getModifiedAt(node.entryPath) ?? 0;

    return { type: node.type, ctime: mtime, mtime, size };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const node = await this.resolveNode(uri);
    if (!node || node.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const result: [string, vscode.FileType][] = [];
    if (node.children) {
      // The children are keyed case insensitively, the names are what is stored
      for (const childNode of node.children.values()) {
        result.push([childNode.name, childNode.type]);
      }
    }

    return result;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const node = await this.resolveNode(uri);
    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const content = await this.archiveModel.getFileContent(node);
    if (!content) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return content;
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    // Reads the archive first: one nobody opened has no nodes to find
    if (await this.resolveNode(uri)) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    await this.archiveModel.createDirectory(uri);

    this.fireSoon({ type: vscode.FileChangeType.Created, uri });
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    // Reads the archive first, or an entry of one nobody opened looks new
    const existingNode = await this.resolveNode(uri);

    if (!existingNode && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (existingNode && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    await this.archiveModel.writeFile(uri, content);

    this.fireSoon({
      type: existingNode
        ? vscode.FileChangeType.Changed
        : vscode.FileChangeType.Created,
      uri,
    });
  }

  async delete(uri: vscode.Uri): Promise<void> {
    await this.resolveNode(uri);
    await this.archiveModel.delete(uri);

    this.fireSoon({ type: vscode.FileChangeType.Deleted, uri });
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    const sourceNode = await this.resolveNode(oldUri);

    if (!sourceNode) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }

    const targetNode = await this.resolveNode(newUri);

    // Resolving to the same node means a rename that only changes the casing
    if (targetNode && targetNode !== sourceNode && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    await this.archiveModel.rename(oldUri, newUri);

    this.fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    );
  }
}
