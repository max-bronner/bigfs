import { workspace, EventEmitter, FileType, Uri } from 'vscode';
import { BIG_PATTERN } from '../constants';
import { parseBigArchive } from './bigParser';
import type { BigFileArchive } from './bigParser';
import path from 'path';

export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
  fileBuffer?: Uint8Array;
}

export class FileService {
  private _onDidChangeArchives = new EventEmitter<Uri>();
  public readonly onDidChangeArchives = this._onDidChangeArchives.event;

  constructor() {
    this.scanWorkspace();
  }

  private async parseArchiveFile(uri: Uri): Promise<BigFileArchive> {
    try {
      const byteArray = await workspace.fs.readFile(uri);
      const buffer = Buffer.from(byteArray);
      return parseBigArchive(buffer);
    } catch (error) {
      throw Error(`Failed to parse archive ${uri.fsPath}:`);
    }
  }

  private async addArchiveToVirtualFileTree(uri: Uri): Promise<void> {
    const data = await this.parseArchiveFile(uri);

    const archiveName = path.basename(uri.path);
    const archivePath = uri.fsPath;
  }

  public async scanWorkspace(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    const archiveUri = await workspace.findFiles(BIG_PATTERN, null, 100);

    archiveUri.forEach((uri) => {
      this.addArchiveToVirtualFileTree(uri);
    });
  }
}
