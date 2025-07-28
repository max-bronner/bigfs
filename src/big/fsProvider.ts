import * as vscode from 'vscode';
import { VirtualFileService } from './virtualFileService';

export class BigFileSystemProvider implements vscode.FileSystemProvider {
  private onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private fileService: VirtualFileService) {
    fileService.onDidChangeArchives((uri: any) => {
      this.onDidChangeFileEmitter.fire([
        {
          type: vscode.FileChangeType.Changed,
          uri,
        },
      ]);
    });
  }

  watch(uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const node = this.fileService.getNode(uri);
    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: node.type,
      ctime: 0,
      mtime: 0,
      size: node.fileBuffer?.length || 0,
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

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    const content = this.fileService.getFile(uri);
    if (!content) {
      throw vscode.FileSystemError.NoPermissions();
    }
    return content;
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const node = this.fileService.getNode(uri);

    if (!node) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (node.type !== vscode.FileType.File) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    try {
      await this.fileService.writeFile(uri, content);

      this.onDidChangeFileEmitter.fire([
        {
          type: vscode.FileChangeType.Changed,
          uri,
        },
      ]);
    } catch (error) {
      console.error('Error writing file:', error);
      throw vscode.FileSystemError.NoPermissions(
        `Failed to write file: ${error}`
      );
    }
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}
