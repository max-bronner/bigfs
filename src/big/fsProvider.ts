import * as vscode from 'vscode';
import { VirtualFileService } from './virtualFileService';

export class BigFileSystemProvider implements vscode.FileSystemProvider {
  private onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private fileService: VirtualFileService) {}

  watch(uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const node = this.fileService.getNode(uri);
    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const size =
      node.type === vscode.FileType.File
        ? this.fileService.getFileSize(uri)
        : 0;

    return {
      type: node.type,
      ctime: 0,
      mtime: 0,
      size,
    };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const node = this.fileService.getNode(uri);
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
    const content = await this.fileService.getFile(uri);
    if (!content) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return content;
  }

  createDirectory(uri: vscode.Uri): void {
    if (this.fileService.getNode(uri)) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    this.fileService.createDirectory(uri);

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
    const existingNode = this.fileService.getNode(uri);

    if (!existingNode && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (existingNode && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    await this.fileService.writeFile(uri, content);

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
    await this.fileService.delete(uri);

    this.onDidChangeFileEmitter.fire([
      {
        type: vscode.FileChangeType.Deleted,
        uri,
      },
    ]);
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}
