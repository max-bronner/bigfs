import * as fs from 'fs';
import type {
  FileChangeEvent,
  FileStat,
  FileSystemProvider,
  Uri,
} from 'vscode';
import { Disposable, EventEmitter, FileType, FileSystemError } from 'vscode';
import {
  parseBigArchive,
  type BigFileArchive,
  type BigFileEntry,
} from './bigParser';

export class BigFileSystemProvider implements FileSystemProvider {
  private readonly _emitter = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  constructor() {}

  private getArchive(bigFilePath: string): BigFileArchive {
    try {
      const buffer = fs.readFileSync(bigFilePath);
      return parseBigArchive(buffer);
    } catch (error) {
      throw new Error(`Failed to parse BIG file ${bigFilePath}`);
    }
  }

  stat(uri: Uri): FileStat {
    return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
  }

  watch(): Disposable {
    return new Disposable(() => {});
  }

  readDirectory(uri: Uri): [string, FileType][] {
    const archive = this.getArchive(uri.fsPath);

    return archive.entries.map(({ name }) => [name, FileType.File]);
  }

  readFile(uri: Uri): Uint8Array {
    return new Uint8Array();
  }

  writeFile(): void {
    throw FileSystemError.NoPermissions();
  }

  delete(): void {
    throw FileSystemError.NoPermissions();
  }

  rename(): void {
    throw FileSystemError.NoPermissions();
  }

  createDirectory(): void {
    throw FileSystemError.NoPermissions();
  }
}
