import * as vscode from 'vscode';
import { FileService } from './virtualFileSystem';

export class BigFileSystemProvider implements vscode.FileSystemProvider {
  private onDidChangeFileEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  constructor(private fileService: FileService) {
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
    return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
  }

  readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
    const node = this.fileService.getNode(uri);

    return Promise.resolve([]);
  }

  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    throw vscode.FileSystemError.NoPermissions();
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}
