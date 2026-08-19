import * as vscode from 'vscode';
import path from 'path';
import type { ArchiveModel } from '../model/archiveModel';
import { SCHEME } from '../constants';
import type { VirtualNode } from '../model/virtualNode';

export class BigFileSystemProvider implements vscode.FileSystemProvider {
  private onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private archiveModel: ArchiveModel) {
    archiveModel.onDidChangeArchive((archivePath) => {
      this.fireChangedDocuments(archivePath);
    });
  }

  private fireChangedDocuments(archivePath: string): void {
    const archivePrefix = `/${path.basename(archivePath)}/`;

    const changes = vscode.workspace.textDocuments
      .filter(
        (document) =>
          document.uri.scheme === SCHEME &&
          !document.isDirty &&
          document.uri.path.startsWith(archivePrefix),
      )
      .map((document) => ({
        type: vscode.FileChangeType.Changed,
        uri: document.uri,
      }));

    if (changes.length) {
      this.onDidChangeFileEmitter.fire(changes);
    }
  }

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  private async resolveNode(
    uri: vscode.Uri,
  ): Promise<VirtualNode | undefined> {
    const node = this.archiveModel.getNode(uri);

    if (node) {
      return node;
    }

    await this.archiveModel.whenReady();

    return this.archiveModel.getNode(uri);
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

    return {
      type: node.type,
      ctime: 0,
      mtime: 0,
      size,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const node = await this.resolveNode(uri);
    if (!node || node.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const result: [string, vscode.FileType][] = [];
    if (node.children) {
      for (const [name, childNode] of node.children) {
        result.push([name, childNode.type]);
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

  createDirectory(uri: vscode.Uri): void {
    if (this.archiveModel.getNode(uri)) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    this.archiveModel.createDirectory(uri);

    this.onDidChangeFileEmitter.fire([
      {
        type: vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const existingNode = this.archiveModel.getNode(uri);

    if (!existingNode && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (existingNode && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    await this.archiveModel.writeFile(uri, content);

    this.onDidChangeFileEmitter.fire([
      {
        type: existingNode
          ? vscode.FileChangeType.Changed
          : vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    await this.archiveModel.delete(uri);

    this.onDidChangeFileEmitter.fire([
      {
        type: vscode.FileChangeType.Deleted,
        uri,
      },
    ]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    if (!this.archiveModel.getNode(oldUri)) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }

    if (this.archiveModel.getNode(newUri) && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    await this.archiveModel.rename(oldUri, newUri);

    this.onDidChangeFileEmitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }
}
